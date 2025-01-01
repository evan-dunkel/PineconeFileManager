import os
import logging
from flask import Flask, render_template, request, redirect, flash, url_for, jsonify, send_file
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
from werkzeug.utils import secure_filename
from pinecone import Pinecone, ServerlessSpec
from openai import OpenAI
from utils import (
    generate_thumbnail, generate_pdf_preview, get_mime_type, 
    is_image, is_pdf, get_file_icon, extract_text_from_file,
    IMAGE_EXTENSIONS, DOCUMENT_EXTENSIONS, chunk_text
)

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Initialize OpenAI client
client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))

# Initialize Pinecone with proper error handling
try:
    pc = Pinecone(api_key=os.environ.get('PINECONE_API_KEY'))
    index_name = "file-manager"

    # List existing indexes
    existing_indexes = pc.list_indexes()

    # Create index if it doesn't exist
    if not any(index.name == index_name for index in existing_indexes):
        pc.create_index(
            name=index_name,
            dimension=1536,  # OpenAI embedding dimension
            metric="cosine",
            spec=ServerlessSpec(
                cloud="aws",
                region="us-west-2"
            )
        )
        logging.info(f"Created new Pinecone index: {index_name}")

    # Get the index
    index = pc.Index(index_name)
    logging.info("Successfully connected to Pinecone")
except Exception as e:
    logging.error(f"Error connecting to Pinecone: {e}")
    pc = None
    index = None

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

# Ensure required directories exist
os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
os.makedirs(os.path.join("static", "thumbnails"), exist_ok=True)

# Initialize extensions
db.init_app(app)

# File upload configuration
ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS.union(DOCUMENT_EXTENSIONS)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    files = db.session.execute(db.select(models.File)).scalars()
    return render_template('index.html', files=files, get_file_icon=get_file_icon)

@app.route('/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400

        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            mime_type = get_mime_type(filename)
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(file_path)

            thumbnail_path = None
            if is_image(mime_type):
                thumbnail_path = generate_thumbnail(file_path, filename)
            elif is_pdf(mime_type):
                thumbnail_path = generate_pdf_preview(file_path, filename)
                logging.info(f"Generated PDF preview: {thumbnail_path}")

            # Extract text content
            text_content = extract_text_from_file(file_path, mime_type)
            vector_id = None

            # Generate embedding and store in Pinecone
            if text_content and client and index:
                try:
                    # Generate base vector_id for the file
                    base_vector_id = f"file_{filename}"

                    # Chunk the text content
                    chunks = chunk_text(text_content)
                    logging.info(f"Split document into {len(chunks)} chunks")

                    vectors_to_upsert = []

                    # Process each chunk
                    for chunk_idx, chunk in enumerate(chunks):
                        # Generate embeddings using OpenAI
                        embedding_response = client.embeddings.create(
                            model="text-embedding-ada-002",
                            input=chunk
                        )

                        if embedding_response and embedding_response.data:
                            # Create a unique vector ID for each chunk
                            chunk_vector_id = f"{base_vector_id}_chunk_{chunk_idx}"

                            # Add vector to the batch
                            vectors_to_upsert.append({
                                'id': chunk_vector_id,
                                'values': embedding_response.data[0].embedding,
                                'metadata': {
                                    'filename': filename,
                                    'mime_type': mime_type,
                                    'chunk_index': chunk_idx,
                                    'total_chunks': len(chunks),
                                    'text_content': chunk[:1000],  # Store first 1000 chars of chunk
                                    'is_chunk': True,
                                    'parent_file': base_vector_id
                                }
                            })

                    # Batch upsert all chunks to Pinecone
                    if vectors_to_upsert:
                        index.upsert(vectors=vectors_to_upsert)
                        vector_id = base_vector_id  # Store the base vector ID
                        logging.info(f"Successfully vectorized file: {filename} with {len(vectors_to_upsert)} chunks")

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
                processed=bool(vector_id)
            )
            db.session.add(new_file)
            db.session.commit()

            return jsonify({'message': 'File uploaded successfully'}), 200

        return jsonify({'error': 'Invalid file type'}), 400

    except Exception as e:
        logging.error(f"Upload error: {e}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/file/<int:file_id>')
def serve_file(file_id):
    """Serve the file for preview or download"""
    file = db.get_or_404(models.File, file_id)
    return send_file(file.filepath, mimetype=file.mime_type)

@app.route('/delete/<int:file_id>', methods=['POST'])
def delete_file(file_id):
    file = db.get_or_404(models.File, file_id)
    try:
        # Delete vector from Pinecone if it exists
        if file.vector_id and pc and index:
            try:
                index.delete(ids=[file.vector_id])
                logging.info(f"Deleted vector for file: {file.filename}")
            except Exception as e:
                logging.error(f"Error deleting vector: {e}")

        # Delete the actual file
        if os.path.exists(file.filepath):
            os.remove(file.filepath)
        # Delete thumbnail if exists
        if file.thumbnail_path:
            thumbnail_path = os.path.join('static', file.thumbnail_path)
            if os.path.exists(thumbnail_path):
                os.remove(thumbnail_path)
        db.session.delete(file)
        db.session.commit()
        flash('File deleted successfully')
    except Exception as e:
        logging.error(f"Error deleting file: {e}")
        flash('Error deleting file')
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

# Initialize database
with app.app_context():
    import models
    db.create_all()