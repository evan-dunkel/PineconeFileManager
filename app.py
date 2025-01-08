import os
import logging
from dotenv import load_dotenv

# Load environment variables first
load_dotenv()

from flask import Flask, render_template, request, redirect, flash, url_for, jsonify, send_file
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
from flask_socketio import SocketIO, emit
from database import db

# Initialize Flask
app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or "development-key"
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///files.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16MB max file size
app.config["UPLOAD_FOLDER"] = "uploads"

# Initialize extensions
db.init_app(app)
socketio = SocketIO(app, cors_allowed_origins="*")

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

def add_api_log(message, level="info", additional_data=None):
    global api_logs
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    
    # Set verbose to True by default
    is_verbose = True
    
    # These are the only messages we want to show in default mode
    if (message.startswith("Search terms identified:") or 
        message.startswith("No search terms found") or
        message.startswith("Found relevant content in") or
        message.startswith("Generated response:")):
        is_verbose = False
    
    log_entry = {
        "timestamp": timestamp,
        "message": message,
        "level": level,
        "verbose": is_verbose,
        **(additional_data or {})
    }
    api_logs.append(log_entry)
    if len(api_logs) > max_logs:
        api_logs = api_logs[-max_logs:]
    socketio.emit('new_log', log_entry)

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
                upload_status['progress'] = 30 + (operation_progress * 0.2)  # 30-50%
            elif operation == 'analyzing':
                upload_status['progress'] = 50 + (operation_progress * 0.2)  # 50-70%
            elif operation == 'vectorizing':
                upload_status['progress'] = 70 + (operation_progress * 0.3)  # 70-100%

# Initialize OpenAI client
client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))

# Initialize Pinecone client
pinecone_client = None
vector_store = None

def init_pinecone():
    global pinecone_client, vector_store
    try:
        api_key = os.environ.get('PINECONE_API_KEY')
        if not api_key:
            logging.error("PINECONE_API_KEY not found in environment variables")
            raise ValueError("PINECONE_API_KEY not found in environment variables")
            
        pinecone_client = Pinecone(api_key=api_key)
        if not pinecone_client:
            raise ValueError("Failed to initialize Pinecone client")
            
        logging.info("Successfully initialized Pinecone client")
        
        # Initialize default index if no indexes exist
        from models import PineconeIndex
        default_index = db.session.query(PineconeIndex).filter_by(name="file-manager").first()
        
        try:
            if not default_index:
                logging.info("Creating default Pinecone index: file-manager")
                # Create default index in Pinecone
                pinecone_client.create_index(
                    name="file-manager",
                    dimension=1536,
                    metric="cosine",
                    spec=ServerlessSpec(cloud="aws", region="us-west-2")
                )
                
                # Wait for index to be ready
                while not pinecone_client.describe_index("file-manager").status['ready']:
                    time.sleep(1)
                
                # Get index details
                index_desc = pinecone_client.describe_index("file-manager")
                
                # Create database record
                default_index = PineconeIndex(
                    name="file-manager",
                    dimension=1536,
                    metric="cosine",
                    cloud="aws",
                    region="us-west-2",
                    status="ready",
                    endpoint=index_desc.host
                )
                db.session.add(default_index)
                db.session.commit()
                
                logging.info("Successfully created default Pinecone index: file-manager")
            else:
                logging.info("Default Pinecone index 'file-manager' already exists")
                
            # Initialize vector store with the default index
            vector_store = pinecone_client.Index("file-manager")
            logging.info("Successfully connected to Pinecone vector store")
            
        except Exception as e:
            if "ALREADY_EXISTS" in str(e):
                logging.info("Default Pinecone index 'file-manager' already exists")
                # Get index details
                index_desc = pinecone_client.describe_index("file-manager")
                
                if not default_index:
                    # Create database record if it doesn't exist
                    default_index = PineconeIndex(
                        name="file-manager",
                        dimension=1536,
                        metric="cosine",
                        cloud="aws",
                        region="us-west-2",
                        status="ready",
                        endpoint=index_desc.host
                    )
                    db.session.add(default_index)
                    db.session.commit()
                
                # Initialize vector store
                vector_store = pinecone_client.Index("file-manager")
                logging.info("Successfully connected to Pinecone vector store")
            else:
                raise

    except Exception as e:
        logging.error(f"Error connecting to Pinecone: {str(e)}")
        pinecone_client = None
        vector_store = None
        raise

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS.union(DOCUMENT_EXTENSIONS)

# Create tables and initialize Pinecone
with app.app_context():
    import models
    # Create upload directory if it doesn't exist
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    # Create static/thumbnails directory if it doesn't exist
    os.makedirs(os.path.join("static", "thumbnails"), exist_ok=True)
    
    # Create tables if they don't exist
    db.create_all()
    init_pinecone()

# Routes
@app.route('/')
def index():
    return redirect(url_for('files'))

@app.route('/files')
def files():
    files = db.session.execute(db.select(models.File)).scalars()
    indexes = db.session.query(models.PineconeIndex).all()
    return render_template('index.html',
                         files=files,
                         indexes=indexes,
                         get_file_icon=get_file_icon)

@app.route('/logs')
def logs():
    indexes = db.session.query(models.PineconeIndex).all()
    return render_template('logs.html', indexes=indexes)

@app.route('/manage-indexes')
def manage_indexes():
    indexes = db.session.query(models.PineconeIndex).all()
    return render_template('indexes.html', indexes=indexes)

@app.route('/indexes')
def list_indexes():
    indexes = db.session.query(models.PineconeIndex).all()
    return render_template('indexes.html', indexes=indexes)

@app.route('/indexes/create', methods=['POST'])
def create_index():
    try:
        name = request.form.get('name')
        dimension = int(request.form.get('dimension', 1536))
        metric = request.form.get('metric', 'cosine')
        cloud = request.form.get('cloud', 'aws')
        region = request.form.get('region', 'us-west-2')
        
        # Create index in Pinecone
        pinecone_client.create_index(
            name=name,
            dimension=dimension,
            metric=metric,
            spec=ServerlessSpec(cloud=cloud, region=region)
        )
        
        # Wait for index to be ready
        while not pinecone_client.describe_index(name).status['ready']:
            time.sleep(1)
        
        # Get index details
        index_desc = pinecone_client.describe_index(name)
        
        # Create database record
        new_index = models.PineconeIndex(
            name=name,
            dimension=dimension,
            metric=metric,
            cloud=cloud,
            region=region,
            status="ready",
            endpoint=index_desc.host
        )
        db.session.add(new_index)
        db.session.commit()
        
        flash(f"Successfully created index: {name}", "success")
        return redirect(url_for('list_indexes'))
        
    except Exception as e:
        flash(f"Error creating index: {str(e)}", "error")
        return redirect(url_for('list_indexes'))

@app.route('/indexes/<int:index_id>/delete', methods=['POST'])
def delete_index(index_id):
    try:
        index = db.session.query(models.PineconeIndex).get(index_id)
        if not index:
            flash("Index not found", "error")
            return redirect(url_for('list_indexes'))
            
        # Check if index has files
        if db.session.query(models.File).filter_by(index_id=index_id).first():
            flash("Cannot delete index that contains files", "error")
            return redirect(url_for('list_indexes'))
            
        # Delete from Pinecone
        pinecone_client.delete_index(index.name)
        
        # Delete from database
        db.session.delete(index)
        db.session.commit()
        
        flash(f"Successfully deleted index: {index.name}", "success")
        return redirect(url_for('list_indexes'))
        
    except Exception as e:
        flash(f"Error deleting index: {str(e)}", "error")
        return redirect(url_for('list_indexes'))

@app.route('/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
            
        index_id = request.form.get('index_id')
        if not index_id:
            return jsonify({'error': 'No index selected'}), 400
            
        index = db.session.query(models.PineconeIndex).get(index_id)
        if not index:
            return jsonify({'error': 'Invalid index selected'}), 400

        if file and allowed_file(file.filename):
            update_status('processing', 'Starting upload...', 'uploading', 0)
            
            filename = secure_filename(file.filename)
            mime_type = get_mime_type(filename)
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(file_path)

            update_status('processing', 'File uploaded, generating preview...', 'processing', 0)

            # Generate display title
            display_title = generate_title(filename)

            thumbnail_path = None
            if is_image(mime_type):
                update_status('processing', 'Processing image...', 'processing', 30)
                thumbnail_path = generate_thumbnail(file_path, filename)
            elif is_pdf(mime_type):
                update_status('processing', 'Generating PDF preview...', 'processing', 30)
                thumbnail_path = generate_pdf_preview(file_path, filename)
                logging.info(f"Generated PDF preview: {thumbnail_path}")

            update_status('processing', 'Extracting content...', 'analyzing', 0)
            # Extract text content
            text_content = extract_text_from_file(file_path, mime_type)
            vector_id = None

            # Generate embedding and store in Pinecone
            if text_content and client:
                try:
                    update_status('processing', 'Analyzing content...', 'analyzing', 50)
                    # Generate base vector_id for the file
                    base_vector_id = f"file_{filename}"

                    # Initialize vector store for this specific index
                    index_vector_store = pinecone_client.Index(index.name)

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
                                'id': chunk_vector_id,
                                'values': embedding_response.data[0].embedding,
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
                        update_status('processing', 'Storing vectors in database...', 'vectorizing', 90)

                        try:
                            index_vector_store.upsert(vectors=vectors_to_upsert)
                            vector_id = base_vector_id
                            logging.info(f"Successfully vectorized file: {filename} with {len(vectors_to_upsert)} chunks")
                            update_status('processing', 'Finalizing...', 'vectorizing', 100)

                        except Exception as e:
                            logging.error(f"Pinecone upsert error: {e}")
                            raise

                except Exception as e:
                    logging.error(f"Error vectorizing file: {e}")
                    return jsonify({'error': f'Error vectorizing file: {str(e)}'}), 500

            # Create database entry
            new_file = models.File(
                filename=filename,
                filepath=file_path,
                mime_type=mime_type,
                thumbnail_path=thumbnail_path,
                vector_id=vector_id,
                processed=bool(vector_id),
                display_title=display_title,
                index_id=index_id
            )
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
    with status_lock:
        if time.time() - upload_status['timestamp'] > 300:
            upload_status['status'] = 'idle'
            upload_status['progress'] = 0
            upload_status['message'] = ''
            upload_status['current_operation'] = ''
            upload_status['operation_progress'] = 0
        return jsonify(upload_status)

@app.route('/file/<int:file_id>')
def serve_file(file_id):
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
                vector_ids = [f"{file.vector_id}_chunk_{i}" for i in range(100)]
                vector_store.delete(ids=vector_ids, namespace="")
                logging.info(f"Successfully deleted vectors for file: {file.filename}")
            except Exception as e:
                logging.error(f"Error deleting vectors: {e}")

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

@app.route('/api/logs')
def get_logs():
    """Return the API logs."""
    verbose = request.args.get('verbose', 'false').lower() == 'true'
    index = request.args.get('index')
    
    filtered_logs = api_logs.copy()
    if not verbose:
        filtered_logs = [log for log in filtered_logs if log.get('verbose') is False]
    if index:
        filtered_logs = [log for log in filtered_logs if log.get('index') == index]
        
    return jsonify(filtered_logs)

@app.route('/api/<index_name>', methods=['GET', 'POST'])
def get_index_info(index_name):
    """Get information about a specific index and its files, or perform a query."""
    try:
        # Query the index from the database
        index = db.session.query(models.PineconeIndex).filter_by(name=index_name).first()
        if not index:
            return jsonify({
                'error': f'Index "{index_name}" not found'
            }), 404
            
        if request.method == 'GET':
            # Get files associated with this index
            files = db.session.query(models.File).filter_by(index_id=index.id).all()
            
            # Get Pinecone index stats
            index_stats = pinecone_client.describe_index(index_name)
            
            return jsonify({
                'index': {
                    'id': index.id,
                    'name': index.name,
                    'dimension': index.dimension,
                    'metric': index.metric,
                    'cloud': index.cloud,
                    'region': index.region,
                    'status': index.status,
                    'endpoint': index.endpoint,
                    'stats': index_stats.dict(),
                },
                'files': [{
                    'id': file.id,
                    'filename': file.filename,
                    'display_title': file.display_title,
                    'mime_type': file.mime_type,
                    'uploaded_at': file.uploaded_at.isoformat(),
                    'processed': file.processed,
                    'vector_id': file.vector_id,
                } for file in files]
            })
        else:  # POST request
            # Validate request
            if not request.is_json:
                return jsonify({'error': 'Request must be JSON'}), 400
                
            data = request.get_json()
            if 'query' not in data:
                return jsonify({'error': 'Query is required'}), 400
                
            query_text = data['query']
            top_k = data.get('top_k', 5)  # Default to 5 results
            additional_context = data.get('additional_context', '')
            
            # Initialize vector store for this index
            vector_store = pinecone_client.Index(index_name)
            
            try:
                # Extract search-relevant information using GPT
                extraction_response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{
                        "role": "system",
                        "content": "IF the query could be a request to search, extract key information from the query that would be relevant for searching a knowledge base. Return only the essential search terms and concepts. Otherwise, return an empty string."
                    }, {
                        "role": "user",
                        "content": query_text
                    }])

                search_terms = extraction_response.choices[0].message.content.strip()
                if not search_terms or search_terms == '""':
                    add_api_log("No search terms found - no Pinecone search necessary", level="info", additional_data={"index": index_name})
                    return jsonify({
                        "answer": "",
                        "contexts": []
                    })
                    
                add_api_log(f"Search terms identified: {search_terms}", level="info", additional_data={"index": index_name})

                # Generate embedding for the extracted search terms
                embedding_response = client.embeddings.create(
                    input=search_terms,
                    model="text-embedding-ada-002"
                )
                
                if not embedding_response or not embedding_response.data:
                    add_api_log("Failed to generate query embedding", level="error")
                    return jsonify({
                        "answer": "",
                        "contexts": []
                    })
                    
                # Query the index
                query_response = vector_store.query(
                    vector=embedding_response.data[0].embedding,
                    top_k=top_k,
                    include_metadata=True
                )
                
                # Process and format results
                contexts = []
                retrieved_context = ""
                
                # Log found content
                for match in query_response.matches:
                    filename = match.metadata.get("filename", "Unknown file")
                    display_title = match.metadata.get("display_title", filename)
                    add_api_log(f"Found relevant content in {display_title}", level="info", additional_data={"index": index_name})
                    
                    # Add to contexts list
                    contexts.append({
                        "id": match.id,
                        "score": match.score,
                        "text": match.metadata.get("text_content", "No content available")
                    })
                    
                    # Add to retrieved context string
                    retrieved_context += match.metadata.get("text_content", "") + " "

                # Add additional context if provided
                if additional_context:
                    retrieved_context += f"\n{additional_context}"

                # Get response from GPT-4
                response = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[{
                        "role": "system",
                        "content": "You are a helpful assistant. Find anything relevant to the query."
                    }, {
                        "role": "user",
                        "content": query_text
                    }, {
                        "role": "system",
                        "content": f"Relevant context: {retrieved_context}"
                    }])
                
                generated_response = response.choices[0].message.content
                add_api_log(f"Generated response: {generated_response}", level="info", additional_data={"index": index_name})

                return jsonify({
                    "answer": generated_response,
                    "contexts": contexts
                })
                
            except Exception as e:
                logging.error(f"Error during query processing: {str(e)}")
                return jsonify({
                    "answer": "",
                    "contexts": []
                })
            
    except Exception as e:
        logging.error(f"Error accessing index: {str(e)}")
        return jsonify({
            'error': f'Error accessing index: {str(e)}'
        }), 500

if __name__ == '__main__':
    socketio.run(app, debug=True)
