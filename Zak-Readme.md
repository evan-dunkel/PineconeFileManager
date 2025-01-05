
# File Management System with AI Integration

## Project Overview
A Flask-based file management system with AI-powered features including automatic title generation, document vectorization, and semantic search capabilities.

## Key Components

### Core Files
- `main.py`: Entry point that runs the Flask server on port 5000
- `app.py`: Main application file containing route handlers and core logic
- `models.py`: Database models using SQLAlchemy
- `utils.py`: Utility functions for file processing and AI operations

### AI & ML Integration

#### OpenAI Integration
- Model: GPT-4 (as specified in utils.py)
- Used for: 
  - Generating human-readable titles for uploaded files
  - Text embedding generation using `text-embedding-ada-002` model

#### Pinecone Vector Database
- Configuration:
  - Dimension: 1536 (OpenAI embedding dimension)
  - Metric: Cosine similarity
  - Cloud: AWS
  - Region: us-west-2
  - Index Name: "file-manager"

### Text Processing
- Chunk size: 4000 characters
- Chunk overlap: 200 characters
- Supported file types:
  - Images: png, jpg, jpeg, gif, webp
  - Documents: pdf, doc, docx, txt

### Database Schema
```sql
File:
  - id: Integer (Primary Key)
  - filename: String(255)
  - filepath: String(512)
  - thumbnail_path: String(512)
  - mime_type: String(128)
  - uploaded_at: DateTime
  - processed: Boolean
  - vector_id: String(64)
  - display_title: String(255)
```

### Technical Dependencies
```toml
Key Dependencies:
- Flask 3.1.0
- SQLAlchemy 2.0.36
- Pinecone 5.4.2
- OpenAI 1.58.1
- Pillow 11.0.0
- pdf2image 1.17.0
- PyPDF2 3.0.1
```

### File Processing Pipeline
1. File Upload
   - Secure filename generation
   - MIME type detection
   - File storage in uploads/

2. Preview Generation
   - Images: Thumbnails (200x200)
   - PDFs: First page preview
   
3. AI Processing
   - Title generation using GPT-4
   - Text extraction based on file type
   - Text chunking with overlap
   - Vector embedding generation
   - Pinecone vector storage

### Environment Requirements
- Python 3.11+
- Linux/Unix environment
- Required environment variables:
  - OPENAI_API_KEY
  - PINECONE_API_KEY
  - FLASK_SECRET_KEY

### Security Features
- Secure filename handling
- MIME type verification
- File size limit: 16MB
- Environment variable protection

### Deployment
- Configured for Replit deployment
- Auto-scales based on demand
- Port configuration: 5000 (internal) -> 80 (external)
