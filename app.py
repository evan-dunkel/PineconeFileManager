import os
import logging
from dotenv import load_dotenv

# Load environment variables first
load_dotenv()

from flask import Flask, render_template, request, redirect, flash, url_for, jsonify, send_file
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
from werkzeug.utils import secure_filename
from pinecone import Pinecone, ServerlessSpec
from openai import OpenAI
from utils import (generate_thumbnail, generate_pdf_preview, get_mime_type,
                   is_image, is_pdf, get_file_icon, extract_text_from_file,
                   IMAGE_EXTENSIONS, DOCUMENT_EXTENSIONS, chunk_text,
                   generate_title)
import pinecone
import time
from threading import Lock
from pydantic import BaseModel
from typing import List, Optional
import json
from dataclasses import dataclass

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Global upload status tracking
upload_status = {
    'status': 'idle',
    'progress': 0,
    'message': '',
    'current_operation': '',
    'operation_progress': 0,
    'timestamp': time.time()
}
status_lock = Lock()

# Global log tracking
api_logs = []
max_logs = 100

def add_api_log(message, level="info"):
    global api_logs
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    api_logs.append({
        "timestamp": timestamp,
        "message": message,
        "level": level
    })
    # Keep only the last max_logs entries
    if len(api_logs) > max_logs:
        api_logs = api_logs[-max_logs:]

# Update the logging configuration to capture API logs
class APILogHandler(logging.Handler):
    def emit(self, record):
        add_api_log(self.format(record), record.levelname.lower())

# Add the custom handler to the root logger
api_log_handler = APILogHandler()
api_log_handler.setFormatter(logging.Formatter('%(message)s'))
logging.getLogger().addHandler(api_log_handler)

def update_status(status, message, operation=None, operation_progress=None):
    with status_lock:
        upload_status['status'] = status
        upload_status['message'] = message
        upload_status['timestamp'] = time.time()

        if operation:
            upload_status['current_operation'] = operation

        if operation_progress is not None:
            upload_status['operation_progress'] = operation_progress

            # Calculate overall progress based on current operation
            if operation == 'uploading':
                upload_status['progress'] = operation_progress * 0.3  # 0-30%
            elif operation == 'processing':
                upload_status['progress'] = 30 + (operation_progress * 0.2
                                                  )  # 30-50%
            elif operation == 'analyzing':
                upload_status['progress'] = 50 + (operation_progress * 0.2
                                                  )  # 50-70%
            elif operation == 'vectorizing':
                upload_status['progress'] = 70 + (operation_progress * 0.3
                                                  )  # 70-100%


# Initialize OpenAI client
client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))

# Initialize Pinecone with proper error handling
try:
    pinecone_client = Pinecone(api_key=os.environ.get('PINECONE_API_KEY'))
    pinecone_index_name = "file-manager"

    # List existing indexes
    existing_indexes = pinecone_client.list_indexes()
    logging.info(
        f"Available indexes: {[idx.name for idx in existing_indexes]}")

    # Create index if it doesn't exist
    if not any(idx.name == pinecone_index_name for idx in existing_indexes):
        pinecone_client.create_index(
            name=pinecone_index_name,
            dimension=1536,  # OpenAI embedding dimension
            metric="cosine",
            spec=ServerlessSpec(cloud="aws", region="us-west-2"))
        logging.info(f"Created new Pinecone index: {pinecone_index_name}")

    # Get the index - Updated for Pinecone 5.0.1
    try:
        # First, describe the index to make sure it exists
        index_description = pinecone_client.describe_index(pinecone_index_name)
        logging.info(f"Index description: {index_description}")

        # Get the index using the correct method for version 5.0.1
        vector_store = pinecone_client.Index(pinecone_index_name)

        # Verify the index object
        logging.info(
            f"Successfully connected to Pinecone index: {pinecone_index_name}")
        logging.info(f"Index type: {type(vector_store)}")
        logging.info(f"Index methods: {dir(vector_store)}")
    except Exception as e:
        logging.error(f"Error getting index: {e}")
        raise

except Exception as e:
    logging.error(f"Error connecting to Pinecone: {e}")
    pinecone_client = None
    vector_store = None

logging.info(f"Pinecone SDK version: {pinecone.__version__}")


class Base(DeclarativeBase):
    pass


db = SQLAlchemy(model_class=Base)
app = Flask(__name__)

# Configuration
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or "development-key"
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///files.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16MB max file size
app.config["UPLOAD_FOLDER"] = "uploads"

# Initialize extensions
db.init_app(app)

# Initialize database
with app.app_context():
    import models  # noqa: F401
    try:
        # Only create tables if they don't exist
        db.create_all()
        logging.info("Successfully initialized database tables")
    except Exception as e:
        logging.error(f"Error initializing database: {e}")
        raise

# File upload configuration
ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS.union(DOCUMENT_EXTENSIONS)


def allowed_file(filename):
    return '.' in filename and filename.rsplit(
        '.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    files = db.session.execute(db.select(models.File)).scalars()
    return render_template('index.html',
                           files=files,
                           get_file_icon=get_file_icon)


@app.route('/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400

        if file and allowed_file(file.filename):
            update_status('processing', 'Starting upload...', 'uploading', 0)

            filename = secure_filename(file.filename)
            mime_type = get_mime_type(filename)
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(file_path)

            update_status('processing', 'File uploaded, generating preview...',
                          'processing', 0)

            # Generate display title
            display_title = generate_title(filename)

            thumbnail_path = None
            if is_image(mime_type):
                update_status('processing', 'Processing image...',
                              'processing', 30)
                thumbnail_path = generate_thumbnail(file_path, filename)
            elif is_pdf(mime_type):
                update_status('processing', 'Generating PDF preview...',
                              'processing', 30)
                thumbnail_path = generate_pdf_preview(file_path, filename)
                logging.info(f"Generated PDF preview: {thumbnail_path}")

            update_status('processing', 'Extracting content...', 'analyzing',
                          0)
            # Extract text content
            text_content = extract_text_from_file(file_path, mime_type)
            vector_id = None

            # Generate embedding and store in Pinecone
            if text_content and client and vector_store:
                try:
                    update_status('processing', 'Analyzing content...',
                                  'analyzing', 50)
                    # Generate base vector_id for the file
                    base_vector_id = f"file_{filename}"

                    # Chunk the text content
                    chunks = chunk_text(text_content)
                    total_chunks = len(chunks)
                    logging.info(f"Split document into {total_chunks} chunks")

                    vectors_to_upsert = []

                    # Process each chunk
                    for chunk_idx, chunk in enumerate(chunks):
                        progress = (chunk_idx / total_chunks) * 100
                        update_status(
                            'processing',
                            f'Vectorizing section {chunk_idx + 1} of {total_chunks}...',
                            'vectorizing', progress)

                        # Generate embeddings using OpenAI
                        embedding_response = client.embeddings.create(
                            model="text-embedding-ada-002", input=chunk)

                        if embedding_response and embedding_response.data:
                            chunk_vector_id = f"{base_vector_id}_chunk_{chunk_idx}"
                            vectors_to_upsert.append({
                                'id':
                                chunk_vector_id,
                                'values':
                                embedding_response.data[0].embedding,
                                'metadata': {
                                    'filename': filename,
                                    'mime_type': mime_type,
                                    'chunk_index': chunk_idx,
                                    'total_chunks': total_chunks,
                                    'text_content': chunk[:1000],
                                    'is_chunk': True,
                                    'parent_file': base_vector_id
                                }
                            })

                    if vectors_to_upsert:
                        update_status('processing',
                                      'Storing vectors in database...',
                                      'vectorizing', 90)

                        try:
                            vectors_for_upsert = []
                            for vector in vectors_to_upsert:
                                vectors_for_upsert.append({
                                    'id':
                                    vector['id'],
                                    'values':
                                    vector['values'],
                                    'metadata':
                                    vector['metadata']
                                })

                            vector_store.upsert(vectors=vectors_for_upsert)
                            vector_id = base_vector_id
                            logging.info(
                                f"Successfully vectorized file: {filename} with {len(vectors_to_upsert)} chunks"
                            )
                            update_status('processing', 'Finalizing...',
                                          'vectorizing', 100)

                        except Exception as e:
                            logging.error(f"Pinecone upsert error: {e}")
                            raise

                except Exception as e:
                    logging.error(f"Error vectorizing file: {e}")
                    return jsonify(
                        {'error': f'Error vectorizing file: {str(e)}'}), 500

            # Create database entry
            new_file = models.File(filename=filename,
                                   filepath=file_path,
                                   mime_type=mime_type,
                                   thumbnail_path=thumbnail_path,
                                   vector_id=vector_id,
                                   processed=bool(vector_id),
                                   display_title=display_title)
            db.session.add(new_file)
            db.session.commit()

            update_status('complete', 'Complete!', 'complete', 100)
            return jsonify({
                'status': 'processing',
                'message': 'Processing complete'
            }), 200

        return jsonify({'error': 'Invalid file type'}), 400

    except Exception as e:
        logging.error(f"Upload error: {e}")
        db.session.rollback()
        update_status('error', str(e), 'error', 0)
        return jsonify({'error': str(e)}), 500


@app.route('/upload/status')
def get_upload_status():
    """Get the current status of the upload process"""
    with status_lock:
        # Clear status if it's too old (5 minutes)
        if time.time() - upload_status['timestamp'] > 300:
            upload_status['status'] = 'idle'
            upload_status['progress'] = 0
            upload_status['message'] = ''
            upload_status['current_operation'] = ''
            upload_status['operation_progress'] = 0

        return jsonify(upload_status)


@app.route('/file/<int:file_id>')
def serve_file(file_id):
    """Serve the file for preview or download"""
    file = db.get_or_404(models.File, file_id)

    return send_file(file.filepath,
                     mimetype=file.mime_type,
                     as_attachment=False,
                     download_name=file.filename)


@app.route('/delete/<int:file_id>', methods=['POST'])
def delete_file(file_id):
    file = db.get_or_404(models.File, file_id)
    try:
        # Delete vector from Pinecone if it exists
        if file.vector_id and vector_store:
            try:
                # Generate the list of potential chunk IDs
                vector_ids = []
                base_id = file.vector_id

                # We know the format is "file_filename_chunk_X"
                for i in range(100):  # Set a reasonable upper limit
                    vector_ids.append(f"{base_id}_chunk_{i}")

                # Delete all vectors associated with this file
                try:
                    logging.info(f"Deleting vectors for file: {file.filename}")
                    vector_store.delete(
                        ids=vector_ids,
                        namespace=""  # Add empty namespace if required
                    )
                    logging.info(
                        f"Successfully deleted vectors for file: {file.filename}"
                    )
                except Exception as e:
                    logging.error(f"Error deleting vectors: {e}")
                    raise

            except Exception as e:
                logging.error(f"Error deleting vector: {e}")

        # Delete the actual file
        if os.path.exists(file.filepath):
            os.remove(file.filepath)
            logging.info(f"Deleted file: {file.filepath}")

        # Delete thumbnail if exists
        if file.thumbnail_path:
            thumbnail_path = os.path.join('static', file.thumbnail_path)
            if os.path.exists(thumbnail_path):
                os.remove(thumbnail_path)
                logging.info(f"Deleted thumbnail: {thumbnail_path}")

        db.session.delete(file)
        db.session.commit()
        flash('File and associated data deleted successfully')
    except Exception as e:
        logging.error(f"Error deleting file: {e}")
        flash('Error deleting file and associated data')
    return redirect(url_for('index'))


@app.route('/rename/<int:file_id>', methods=['POST'])
def rename_file(file_id):
    file = db.get_or_404(models.File, file_id)
    new_name = request.form.get('new_name')

    if not new_name:
        flash('New name is required')
        return redirect(url_for('index'))

    try:
        new_name = secure_filename(new_name)
        new_path = os.path.join(app.config['UPLOAD_FOLDER'], new_name)
        os.rename(file.filepath, new_path)
        file.filename = new_name
        file.filepath = new_path
        db.session.commit()
        flash('File renamed successfully')
    except Exception as e:
        logging.error(f"Error renaming file: {e}")
        flash('Error renaming file')

    return redirect(url_for('index'))


# Add data classes for request/response validation
@dataclass
class DynamicContextRequest:
    query: str
    userID: str
    additional_context: Optional[str] = None

@dataclass
class DynamicContextResponse:
    answer: str
    contexts: List[dict]

@app.route('/api/dynamic-context', methods=['POST'])
def get_dynamic_context():
    try:
        data = request.get_json()
        # Create request object with only the fields we need
        context_request = DynamicContextRequest(
            query=data['query'],
            userID=data['userID'],
            additional_context=data.get('additional_context')
        )
        
        print(f"Query: {context_request.query}")
        # Extract search-relevant information using GPT
        extraction_response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "system",
                "content": "IF the query could be a request to search, extract key information from the query that would be relevant for searching a knowledge base. Return only the essential search terms and concepts. Otherwise, return an empty string."
            }, {
                "role": "user",
                "content": context_request.query
            }])

        search_terms = extraction_response.choices[0].message.content.strip()
        print("Search Terms:", f"'{search_terms}'")

        # Return empty response immediately if no search terms or just quotes
        if not search_terms or search_terms == '""':
            print("No search terms found - returning empty response")
            return jsonify(DynamicContextResponse(answer="", contexts=[]).__dict__)

        # Generate embedding for the extracted search terms
        query_embedding = client.embeddings.create(
            input=search_terms,
            model="text-embedding-ada-002").data[0].embedding

        # Query Pinecone for similar context
        search_results = vector_store.query(vector=query_embedding,
                                     top_k=3,
                                     include_metadata=True)
        print("Pinecone search results:", search_results)

        # Prepare context
        print("Processing matches...")
        contexts = [{
            "id": match["id"],
            "score": match["score"],
            "text": match["metadata"].get("text_content", "No content available")
        } for match in search_results["matches"]]

        retrieved_context = " ".join([
            match["metadata"].get("text_content", "")
            for match in search_results["matches"]
        ])
        print("Number of matches:", len(search_results["matches"]))

        # Additional context if provided
        if context_request.additional_context:
            retrieved_context += f"\n{context_request.additional_context}"

        # Get response from GPT-4
        print("Sending query to GPT with context length:", len(retrieved_context))
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": "You are a helpful assistant. Find anything relevant to the query."
            }, {
                "role": "user",
                "content": context_request.query
            }, {
                "role": "system",
                "content": f"Relevant context: {retrieved_context}"
            }])
        print("GPT Response:", response.choices[0].message.content)

        return jsonify(DynamicContextResponse(
            answer=response.choices[0].message.content,
            contexts=contexts
        ).__dict__)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/health')
def health_check():
    return jsonify({"status": "healthy"})

@app.route('/api/logs')
def get_api_logs():
    """Get the current API logs"""
    return jsonify(api_logs)


if __name__ == '__main__':
    with app.app_context():
        import models
        db.create_all()
    app.run(debug=True)
