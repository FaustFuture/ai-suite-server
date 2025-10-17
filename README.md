# Backend API Server

This is the Express.js backend server that handles document processing, knowledge ingestion, and AI response generation.

## Features

- **Document Processing**: Upload and process PDFs, Word docs, Excel files, and more
- **Knowledge Ingestion**: Extract text, chunk content, and generate embeddings
- **AI Response Generation**: Generate responses using Gemini AI with knowledge retrieval
- **File Management**: Handle file uploads, duplicate detection, and storage

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Create a `.env` file in the backend directory:
   ```env
   # Supabase Configuration
   SUPABASE_URL=your_supabase_url_here
   SUPABASE_ANON_KEY=your_supabase_anon_key_here

   # Gemini API Configuration
   GEMINI_API_KEY=your_gemini_api_key_here

   # Server Configuration
   PORT=3000
   ```

3. **Start the Server**
   ```bash
   # Development mode with auto-restart
   npm run dev

   # Production mode
   npm start
   ```

## API Endpoints

### Document Ingestion
- `POST /api/ingest-document` - Upload and process documents
- `GET /api/processing-stats/:agentId` - Get processing statistics
- `DELETE /api/delete-file/:agentId/:fileHash` - Delete file chunks

### AI Response Generation
- `POST /api/generate-response` - Generate AI responses with knowledge retrieval

### Health Check
- `GET /health` - Server health status

## Supported File Types

- **Text Files**: .txt, .md, .csv, .json, .xml
- **PDF Files**: .pdf (with text extraction)
- **Microsoft Word**: .doc, .docx
- **Microsoft Excel**: .xls, .xlsx
- **OpenDocument**: .odt, .ods, .odp

## Architecture

```
Frontend (Next.js) → Backend (Express) → Supabase (Database)
                           ↓
                    Gemini AI (Embeddings & Generation)
```

## Error Handling

The backend includes comprehensive error handling for:
- File validation and size limits
- Duplicate file detection
- PDF processing errors
- API rate limiting
- Database connection issues

## Development

- Uses `nodemon` for auto-restart during development
- CORS enabled for frontend integration
- Comprehensive logging for debugging
- Fallback mechanisms for failed operations
