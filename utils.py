import os
import mimetypes
from PIL import Image
import logging
from werkzeug.utils import secure_filename

THUMBNAIL_SIZE = (200, 200)
IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
DOCUMENT_EXTENSIONS = {'pdf', 'doc', 'docx', 'txt'}

def get_mime_type(filename):
    return mimetypes.guess_type(filename)[0] or 'application/octet-stream'

def is_image(mime_type):
    return mime_type.startswith('image/')

def generate_thumbnail(filepath, filename):
    """Generate a thumbnail for an image file"""
    try:
        thumbnail_dir = os.path.join('static', 'thumbnails')
        os.makedirs(thumbnail_dir, exist_ok=True)
        
        thumbnail_filename = f"thumb_{secure_filename(filename)}"
        thumbnail_path = os.path.join(thumbnail_dir, thumbnail_filename)
        
        with Image.open(filepath) as img:
            img.thumbnail(THUMBNAIL_SIZE)
            img.save(thumbnail_path, "JPEG")
        
        return os.path.join('thumbnails', thumbnail_filename)
    except Exception as e:
        logging.error(f"Error generating thumbnail: {e}")
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
    return 'file'
