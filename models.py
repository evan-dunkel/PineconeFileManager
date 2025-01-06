from datetime import datetime
from database import db

class PineconeIndex(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, unique=True)
    dimension = db.Column(db.Integer, nullable=False, default=1536)
    metric = db.Column(db.String(64), nullable=False, default="cosine")
    cloud = db.Column(db.String(64), nullable=False, default="aws")
    region = db.Column(db.String(64), nullable=False, default="us-west-2")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(64), default="created")
    endpoint = db.Column(db.String(512))
    files = db.relationship('File', backref='index', lazy=True)

class File(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    filepath = db.Column(db.String(512), nullable=False)
    thumbnail_path = db.Column(db.String(512))
    mime_type = db.Column(db.String(128))
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)
    processed = db.Column(db.Boolean, default=False)
    vector_id = db.Column(db.String(64))  # Store Pinecone vector ID
    display_title = db.Column(db.String(255))  # Store the AI-generated title
    index_id = db.Column(db.Integer, db.ForeignKey('pinecone_index.id'), nullable=False)