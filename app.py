import os
import logging
from flask import Flask, render_template, request, redirect, flash, url_for
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
from werkzeug.utils import secure_filename
from pinecone import Pinecone

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

# Ensure upload directory exists
os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

# Initialize extensions
db.init_app(app)

# File upload configuration
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'doc', 'docx'}

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
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        # Create database entry
        new_file = models.File(
            filename=filename,
            filepath=file_path
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

with app.app_context():
    import models
    db.create_all()