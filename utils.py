import os
import mimetypes
from PIL import Image
import logging
from werkzeug.utils import secure_filename
from pdf2image import convert_from_path
import tempfile
import PyPDF2
import docx2txt

THUMBNAIL_SIZE = (200, 200)
IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
DOCUMENT_EXTENSIONS = {'pdf', 'doc', 'docx', 'txt'}

def get_mime_type(filename):
    """Get the MIME type of a file"""
    return mimetypes.guess_type(filename)[0] or 'application/octet-stream'

def is_image(mime_type):
    """Check if the MIME type is an image"""
    return mime_type.startswith('image/')

def is_pdf(mime_type):
    """Check if the MIME type is a PDF"""
    return mime_type == 'application/pdf'

def extract_text_from_pdf(filepath):
    """Extract text content from PDF file"""
    try:
        text = ""
        with open(filepath, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
        return text.strip()
    except Exception as e:
        logging.error(f"Error extracting text from PDF: {e}")
        return ""

def extract_text_from_docx(filepath):
    """Extract text content from DOCX file"""
    try:
        return docx2txt.process(filepath)
    except Exception as e:
        logging.error(f"Error extracting text from DOCX: {e}")
        return ""

def extract_text_from_file(filepath, mime_type):
    """Extract text content from various file types"""
    try:
        if mime_type == 'application/pdf':
            return extract_text_from_pdf(filepath)
        elif mime_type in ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword']:
            return extract_text_from_docx(filepath)
        elif mime_type.startswith('text/'):
            with open(filepath, 'r', encoding='utf-8') as file:
                return file.read()
        return ""
    except Exception as e:
        logging.error(f"Error extracting text from file: {e}")
        return ""

def generate_thumbnail(filepath, filename):
    """Generate a thumbnail for an image file"""
    try:
        thumbnail_dir = os.path.join('static', 'thumbnails')
        os.makedirs(thumbnail_dir, exist_ok=True)

        thumbnail_filename = f"thumb_{secure_filename(filename)}"
        thumbnail_path = os.path.join(thumbnail_dir, thumbnail_filename)

        with Image.open(filepath) as img:
            # Convert to RGB if necessary (for PNG with transparency)
            if img.mode in ('RGBA', 'P'): 
                img = img.convert('RGB')
            img.thumbnail(THUMBNAIL_SIZE)
            img.save(thumbnail_path, "JPEG", quality=85)

        return os.path.join('thumbnails', thumbnail_filename)
    except Exception as e:
        logging.error(f"Error generating thumbnail: {e}")
        return None

def generate_pdf_preview(filepath, filename):
    """Generate a preview image for a PDF file"""
    try:
        thumbnail_dir = os.path.join('static', 'thumbnails')
        os.makedirs(thumbnail_dir, exist_ok=True)

        thumbnail_filename = f"pdf_thumb_{secure_filename(filename)}.jpg"
        thumbnail_path = os.path.join(thumbnail_dir, thumbnail_filename)

        # Convert only the first page of the PDF
        with tempfile.TemporaryDirectory() as temp_dir:
            images = convert_from_path(filepath, first_page=1, last_page=1, output_folder=temp_dir)
            if images:
                # Get the first page and create a thumbnail
                preview = images[0]
                preview.thumbnail(THUMBNAIL_SIZE)
                preview.save(thumbnail_path, "JPEG", quality=85)
                return os.path.join('thumbnails', thumbnail_filename)
    except Exception as e:
        logging.error(f"Error generating PDF preview: {e}")
    return None

def get_file_icon(mime_type):
    """Return appropriate icon based on mime type"""
    if mime_type.startswith('image/'):
        return 'image'
    elif mime_type.startswith('text/'):
        return 'file-text'
    elif 'pdf' in mime_type:
        return 'file-pdf'
    elif 'word' in mime_type or 'document' in mime_type:
        return 'file-word'
    elif 'spreadsheet' in mime_type or 'excel' in mime_type:
        return 'file-spreadsheet'
    elif 'presentation' in mime_type or 'powerpoint' in mime_type:
        return 'file-presentation'
    return 'file'