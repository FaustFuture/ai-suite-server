const { GoogleGenerativeAI } = require('@google/generative-ai');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Lazy-loaded Supabase client
let supabase = null;

function getSupabaseClient() {
  if (!supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Supabase environment variables are not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file.');
    }
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }
  return supabase;
}

class CoachAIKnowledgeIngestionService {
  static DEFAULT_CHUNKING_OPTIONS = {
    minTokens: 50,
    maxTokens: 500,
    overlapTokens: 50
  };

  // Maximum characters per chunk to avoid API limits
  static MAX_CHARS_PER_CHUNK = 30000;

  static SUPPORTED_FILE_TYPES = [
    // Text files
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/rtf',
    'application/json',
    'application/xml',
    'text/xml',

    // PDF files
    'application/pdf',

    // Microsoft Word
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

    // Microsoft Excel
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

    // Microsoft PowerPoint
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',

    // OpenDocument formats
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',

    // Other document formats
    'application/rtf',
    'text/richtext'
  ];

  static IMAGE_FILE_TYPES = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/bmp',
    'image/svg+xml',
    'image/webp',
    'image/tiff',
    'image/ico',
    'image/x-icon'
  ];

  static MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB for Coach AI (higher limit)

  /**
   * Main entry point for Coach AI document ingestion
   */
  static async ingestDocument(fileBuffer, fileName, fileType, fileSize, companyId, options = {}) {
    try {
      console.log(`🤖 Coach AI Knowledge Ingestion - Processing file: ${fileName}`);
      console.log(`📊 File details: ${fileSize} bytes, type: ${fileType}, company: ${companyId}`);

      // Validate file
      this.validateFile(fileType, fileSize);

      // Generate file hash for duplicate detection
      const fileHash = this.generateFileHash(fileBuffer);

      // Check for duplicates
      const isDuplicate = await this.checkForDuplicate(companyId, fileHash, fileName);
      if (isDuplicate) {
        console.log('🚫 DUPLICATE DETECTED - Blocking upload for Coach AI');
        return {
          success: false,
          chunks: [],
          totalChunks: 0,
          isDuplicate: true,
          message: 'This file has already been uploaded to your Coach AI knowledge base. Please choose a different file.'
        };
      }

      // Extract text content from file
      const textContent = await this.extractTextFromFile(fileBuffer, fileType);
      console.log(`📝 Extracted text length: ${textContent.length} characters`);
      console.log(`📄 First 200 characters: ${textContent.substring(0, 200)}`);

      // Log if text was significantly reduced
      if (textContent.length < 100) {
        console.log(`⚠️  Warning: Very short text extracted (${textContent.length} chars). This might indicate heavy image filtering or document issues.`);
      }

      // Chunk the content
      const chunkingOptions = { ...this.DEFAULT_CHUNKING_OPTIONS, ...options };
      const chunks = await this.chunkText(textContent, chunkingOptions);
      console.log(`📦 Created ${chunks.length} chunks for Coach AI`);

      // Generate embeddings and create knowledge chunks
      const knowledgeChunks = await this.processChunks(
        chunks,
        fileName,
        fileType,
        fileSize,
        companyId,
        fileHash
      );

      // Store in database
      const storedChunks = await this.storeChunks(knowledgeChunks);

      console.log(`✅ Coach AI Knowledge Ingestion Complete - Stored ${storedChunks.length} chunks`);

      return {
        success: true,
        chunks: storedChunks,
        totalChunks: storedChunks.length,
        isDuplicate: false,
        message: `Successfully processed ${fileName} and created ${storedChunks.length} knowledge chunks for your Coach AI.`
      };

    } catch (error) {
      console.error('❌ Coach AI Knowledge Ingestion Error:', error);
      return {
        success: false,
        chunks: [],
        totalChunks: 0,
        isDuplicate: false,
        message: `Failed to process file: ${error.message}`
      };
    }
  }

  /**
   * Validate file type and size
   */
  static validateFile(fileType, fileSize) {
    if (!this.SUPPORTED_FILE_TYPES.includes(fileType)) {
      throw new Error(`Unsupported file type: ${fileType}. Supported types: ${this.SUPPORTED_FILE_TYPES.join(', ')}`);
    }

    if (fileSize > this.MAX_FILE_SIZE) {
      throw new Error(`File size (${(fileSize / (1024 * 1024)).toFixed(1)}MB) exceeds the maximum allowed size of ${(this.MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)}MB`);
    }
  }

  /**
   * Generate file hash for duplicate detection
   */
  static generateFileHash(fileBuffer) {
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Check for duplicate files in Coach AI knowledge base
   */
  static async checkForDuplicate(companyId, fileHash, fileName) {
    try {
      const { data, error } = await getSupabaseClient()
        .from('coach_ai_knowledge')
        .select('id, file_name, created_at')
        .eq('company_id', companyId)
        .eq('file_hash', fileHash)
        .limit(1);

      if (error) {
        console.error('Error checking for duplicates:', error);
        return false; // If we can't check, allow the upload
      }

      if (data && data.length > 0) {
        console.log(`🚫 Duplicate found: ${fileName} (hash: ${fileHash.substring(0, 8)}...)`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error in duplicate check:', error);
      return false; // If we can't check, allow the upload
    }
  }

  /**
   * Extract text content from various file types
   */
  static async extractTextFromFile(fileBuffer, fileType) {
    console.log(`📖 Extracting text from ${fileType} file...`);

    try {
      switch (fileType) {
        case 'text/plain':
        case 'text/markdown':
        case 'text/csv':
        case 'text/rtf':
        case 'application/json':
        case 'application/xml':
        case 'text/xml':
        case 'text/richtext':
          return fileBuffer.toString('utf-8');

        case 'application/pdf':
          return await this.extractTextFromPDF(fileBuffer);

        case 'application/msword':
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
          return await this.extractTextFromWord(fileBuffer);

        case 'application/vnd.ms-excel':
        case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
          return await this.extractTextFromExcel(fileBuffer);

        case 'application/vnd.ms-powerpoint':
        case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
          return await this.extractTextFromPowerPoint(fileBuffer);

        case 'application/vnd.oasis.opendocument.text':
        case 'application/vnd.oasis.opendocument.spreadsheet':
        case 'application/vnd.oasis.opendocument.presentation':
          return await this.extractTextFromOpenDocument(fileBuffer);

        default:
          throw new Error(`Unsupported file type: ${fileType}`);
      }
    } catch (error) {
      console.error(`Error extracting text from ${fileType}:`, error);
      throw new Error(`Failed to extract text from file: ${error.message}`);
    }
  }

  /**
   * Extract text from PDF files
   */
  static async extractTextFromPDF(fileBuffer) {
    try {
      const data = await pdfParse(fileBuffer);
      return data.text;
    } catch (error) {
      throw new Error(`Failed to parse PDF: ${error.message}`);
    }
  }

  /**
   * Extract text from Word documents
   */
  static async extractTextFromWord(fileBuffer) {
    try {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      return result.value;
    } catch (error) {
      throw new Error(`Failed to parse Word document: ${error.message}`);
    }
  }

  /**
   * Extract text from Excel files
   */
  static async extractTextFromExcel(fileBuffer) {
    try {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      let text = '';

      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = XLSX.utils.sheet_to_csv(worksheet);
        text += `Sheet: ${sheetName}\n${sheetData}\n\n`;
      });

      return text;
    } catch (error) {
      throw new Error(`Failed to parse Excel file: ${error.message}`);
    }
  }

  /**
   * Extract text from PowerPoint files
   */
  static async extractTextFromPowerPoint(fileBuffer) {
    try {
      // For PowerPoint, we'll use a simple approach
      // In a production environment, you might want to use a more sophisticated library
      const text = fileBuffer.toString('utf-8');
      
      // Extract text between common PowerPoint text markers
      const textMatches = text.match(/<a:t[^>]*>([^<]*)<\/a:t>/g);
      if (textMatches) {
        return textMatches
          .map(match => match.replace(/<[^>]*>/g, ''))
          .join('\n');
      }

      // Fallback: try to extract any readable text
      return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    } catch (error) {
      throw new Error(`Failed to parse PowerPoint file: ${error.message}`);
    }
  }

  /**
   * Extract text from OpenDocument files
   */
  static async extractTextFromOpenDocument(fileBuffer) {
    try {
      const text = fileBuffer.toString('utf-8');
      
      // Extract text between OpenDocument text markers
      const textMatches = text.match(/<text:[^>]*>([^<]*)<\/text:[^>]*>/g);
      if (textMatches) {
        return textMatches
          .map(match => match.replace(/<[^>]*>/g, ''))
          .join('\n');
      }

      // Fallback: try to extract any readable text
      return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    } catch (error) {
      throw new Error(`Failed to parse OpenDocument: ${error.message}`);
    }
  }

  /**
   * Chunk text into optimal sizes for embedding (same as original service)
   */
  static async chunkText(text, options) {
    // Simple token estimation: ~4 characters per token
    const charsPerToken = 4;
    const minChars = options.minTokens * charsPerToken;
    const maxChars = Math.min(options.maxTokens * charsPerToken, this.MAX_CHARS_PER_CHUNK);
    const overlapChars = options.overlapTokens * charsPerToken;

    console.log(`📦 Coach AI Chunking options: minChars=${minChars}, maxChars=${maxChars}, overlapChars=${overlapChars}, maxCharsLimit=${this.MAX_CHARS_PER_CHUNK}`);

    // Split by paragraphs first
    const paragraphs = text
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    console.log(`📄 Found ${paragraphs.length} paragraphs for Coach AI`);

    const chunks = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      // If paragraph itself is too large, split it further
      if (paragraph.length > this.MAX_CHARS_PER_CHUNK) {
        console.log(`📏 Large paragraph detected (${paragraph.length} chars), splitting further for Coach AI...`);

        // Save current chunk if it exists
        if (currentChunk.trim().length >= minChars) {
          chunks.push(currentChunk.trim());
          console.log(`✅ Added Coach AI chunk of length ${currentChunk.length}`);
        }

        // Split large paragraph into smaller chunks
        const subChunks = this.splitLargeText(paragraph, maxChars, overlapChars);
        chunks.push(...subChunks);
        currentChunk = '';
        continue;
      }

      // If adding this paragraph would exceed max size, save current chunk
      if (currentChunk.length + paragraph.length > maxChars && currentChunk.length > 0) {
        if (currentChunk.length >= minChars) {
          chunks.push(currentChunk.trim());
          console.log(`✅ Added Coach AI chunk of length ${currentChunk.length}`);
        } else {
          console.log(`⏭️  Skipped Coach AI chunk of length ${currentChunk.length} (below minimum ${minChars})`);
        }

        // Start new chunk with overlap from previous chunk
        const overlapText = currentChunk.slice(-overlapChars);
        currentChunk = overlapText + '\n\n' + paragraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }

    // Add the last chunk if it meets minimum size
    if (currentChunk.trim().length >= minChars) {
      chunks.push(currentChunk.trim());
      console.log(`✅ Added final Coach AI chunk of length ${currentChunk.length}`);
    } else {
      console.log(`⏭️  Skipped final Coach AI chunk of length ${currentChunk.length} (below minimum ${minChars})`);
    }

    // If no chunks were created (very short content), create one chunk
    if (chunks.length === 0 && text.trim().length > 0) {
      chunks.push(text.trim());
      console.log(`📝 Created single Coach AI chunk for short content of length ${text.trim().length}`);
    }

    // Final safety check: ensure no chunk exceeds the API limit
    const finalChunks = chunks.map(chunk => {
      if (chunk.length > this.MAX_CHARS_PER_CHUNK) {
        console.log(`⚠️  Coach AI chunk too large (${chunk.length} chars), splitting further...`);
        return this.splitLargeText(chunk, maxChars, overlapChars);
      }
      return [chunk];
    }).flat();

    console.log(`🎯 Final Coach AI chunking result: ${finalChunks.length} chunks`);
    finalChunks.forEach((chunk, index) => {
      console.log(`  📦 Coach AI Chunk ${index + 1}: ${chunk.length} characters`);
    });

    return finalChunks;
  }

  /**
   * Split large text into smaller chunks (same as original service)
   */
  static splitLargeText(text, maxChars, overlapChars) {
    const chunks = [];
    let start = 0;

    while (start < text.length) {
      let end = start + maxChars;

      // Try to break at sentence boundary
      if (end < text.length) {
        const sentenceEnd = text.lastIndexOf('.', end);
        const questionEnd = text.lastIndexOf('?', end);
        const exclamationEnd = text.lastIndexOf('!', end);
        const lineBreak = text.lastIndexOf('\n', end);

        const breakPoint = Math.max(sentenceEnd, questionEnd, exclamationEnd, lineBreak);
        if (breakPoint > start + maxChars * 0.5) { // Don't break too early
          end = breakPoint + 1;
        }
      }

      const chunk = text.slice(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
        console.log(`  📦 Split Coach AI chunk: ${chunk.length} characters`);
      }

      // Move start position with overlap
      start = Math.max(start + 1, end - overlapChars);
    }

    return chunks;
  }

  /**
   * Process chunks: generate embeddings and create Coach AI knowledge chunk objects
   */
  static async processChunks(chunks, fileName, fileType, fileSize, companyId, fileHash) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

    const knowledgeChunks = [];

    console.log(`🤖 Generating embeddings for ${chunks.length} Coach AI chunks...`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      try {
        // Generate embedding
        const result = await model.embedContent(chunk);
        const embedding = result.embedding.values;

        knowledgeChunks.push({
          company_id: companyId,
          content: chunk,
          embedding,
          file_name: fileName,
          file_type: fileType,
          file_size: fileSize,
          file_hash: fileHash,
          chunk_index: i,
          total_chunks: chunks.length,
          metadata: {
            original_file_name: fileName,
            file_type: fileType,
            file_size: fileSize,
            chunk_index: i,
            total_chunks: chunks.length,
            processed_at: new Date().toISOString(),
            token_estimate: Math.ceil(chunk.length / 4), // Rough token estimation
            knowledge_type: 'coach_ai'
          }
        });

        console.log(`✅ Generated embedding for Coach AI chunk ${i + 1}/${chunks.length}`);
      } catch (error) {
        console.error(`❌ Error processing Coach AI chunk ${i}:`, error);
        // Continue with other chunks even if one fails
      }
    }

    console.log(`🎯 Successfully processed ${knowledgeChunks.length} Coach AI chunks with embeddings`);
    return knowledgeChunks;
  }

  /**
   * Store Coach AI knowledge chunks in database
   */
  static async storeChunks(chunks) {
    if (chunks.length === 0) {
      return [];
    }

    console.log(`💾 Storing ${chunks.length} Coach AI knowledge chunks in database...`);

    const { data, error } = await getSupabaseClient()
      .from('coach_ai_knowledge')
      .insert(chunks)
      .select();

    if (error) {
      throw new Error(`Failed to store Coach AI knowledge chunks: ${error.message}`);
    }

    console.log(`✅ Successfully stored ${data?.length || 0} Coach AI knowledge chunks`);
    return data || [];
  }

  /**
   * Get processing statistics for a company's Coach AI
   */
  static async getProcessingStats(companyId) {
    const { data, error } = await getSupabaseClient()
      .from('coach_ai_knowledge')
      .select('file_name, file_size, created_at')
      .eq('company_id', companyId);

    if (error) {
      throw new Error(`Failed to get Coach AI processing stats: ${error.message}`);
    }

    const uniqueFiles = new Set(data?.map(chunk => chunk.file_name) || []);
    const totalChunks = data?.length || 0;
    const totalSize = data?.reduce((sum, chunk) => sum + chunk.file_size, 0) || 0;
    const lastProcessed = data?.length > 0
      ? data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0].created_at
      : null;

    return {
      totalFiles: uniqueFiles.size,
      totalChunks,
      totalSize,
      lastProcessed
    };
  }

  /**
   * Delete all chunks for a specific file from Coach AI knowledge base
   */
  static async deleteFileChunks(companyId, fileHash) {
    console.log(`🗑️  Deleting Coach AI file chunks for company ${companyId}, hash: ${fileHash.substring(0, 8)}...`);

    const { error } = await getSupabaseClient()
      .from('coach_ai_knowledge')
      .delete()
      .eq('company_id', companyId)
      .eq('file_hash', fileHash);

    if (error) {
      throw new Error(`Failed to delete Coach AI file chunks: ${error.message}`);
    }

    console.log(`✅ Successfully deleted Coach AI file chunks`);
  }
}

module.exports = CoachAIKnowledgeIngestionService;
