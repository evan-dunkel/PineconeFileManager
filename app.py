import os
import logging
from flask import Flask, render_template, request, redirect, flash, url_for
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
from werkzeug.utils import secure_filename
from pinecone import Pinecone
from utils import generate_thumbnail, get_mime_type, is_image, IMAGE_EXTENSIONS, DOCUMENT_EXTENSIONS

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Initialize Pinecone with proper error handling
try:
    pc = Pinecone(api_key=os.environ.get('PINECONE_API_KEY'))
    logging.info("Successfully connected to Pinecone")
except Exception as e:
    logging.error(f"Error connecting to Pinecone: {e}")
    pc = None

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
    return render_template('index.html', files=files)

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        flash('No file part')
        return redirect(request.url)

    file = request.files['file']
    if file.filename == '':
        flash('No selected file')
        return redirect(request.url)

    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        mime_type = get_mime_type(filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        thumbnail_path = None
        if is_image(mime_type):
            thumbnail_path = generate_thumbnail(file_path, filename)

        # Create database entry
        new_file = models.File(
            filename=filename,
            filepath=file_path,
            mime_type=mime_type,
            thumbnail_path=thumbnail_path
        )
        db.session.add(new_file)
        db.session.commit()

        flash('File successfully uploaded')
        return redirect(url_for('index'))

    flash('Invalid file type')
    return redirect(url_for('index'))

@app.route('/delete/<int:file_id>', methods=['POST'])
def delete_file(file_id):
    file = db.get_or_404(models.File, file_id)
    try:
        os.remove(file.filepath)
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
    # Drop all tables and recreate them with the new schema
    db.drop_all()
    db.create_all()