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

class KnowledgeIngestionService {
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

  static MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  /**
   * Main entry point for document ingestion
   */
  static async ingestDocument(fileBuffer, fileName, fileType, fileSize, agentId, options = {}) {
    try {
      // Validate file
      this.validateFile(fileType, fileSize);

      // Generate file hash for duplicate detection
      const fileHash = this.generateFileHash(fileBuffer);

      // Check for duplicates
      const isDuplicate = await this.checkForDuplicate(agentId, fileHash, fileName);
      if (isDuplicate) {
        console.log('🚫 DUPLICATE DETECTED - Blocking upload');
        return {
          success: false,
          chunks: [],
          totalChunks: 0,
          isDuplicate: true,
          message: 'This file has already been uploaded to this agent. Please choose a different file.'
        };
      }

      // Extract text content from file
      const textContent = await this.extractTextFromFile(fileBuffer, fileType);
      console.log(`Extracted text length: ${textContent.length} characters`);
      console.log(`First 200 characters: ${textContent.substring(0, 200)}`);

      // Log if text was significantly reduced
      if (textContent.length < 100) {
        console.log(`Warning: Very short text extracted (${textContent.length} chars). This might indicate heavy image filtering or document issues.`);
      }

      // Chunk the content
      const chunkingOptions = { ...this.DEFAULT_CHUNKING_OPTIONS, ...options };
      const chunks = await this.chunkText(textContent, chunkingOptions);
      console.log(`Created ${chunks.length} chunks`);

      // Generate embeddings and create knowledge chunks
      const knowledgeChunks = await this.processChunks(
        chunks,
        fileName,
        fileType,
        fileSize,
        agentId,
        fileHash
      );

      // Store in database
      const storedChunks = await this.storeChunks(knowledgeChunks);

      return {
        success: true,
        chunks: storedChunks,
        totalChunks: storedChunks.length,
        isDuplicate: false,
        message: `Successfully processed ${storedChunks.length} chunks from ${fileName}`
      };

    } catch (error) {
      console.error('Document ingestion error:', error);
      return {
        success: false,
        chunks: [],
        totalChunks: 0,
        isDuplicate: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Validate file type and size
   */
  static validateFile(fileType, fileSize) {
    // Explicitly reject image files
    if (this.IMAGE_FILE_TYPES.includes(fileType)) {
      throw new Error(
        `Image files are not supported for text processing. File type: ${fileType}. Please upload text-based documents only.`
      );
    }

    if (!this.SUPPORTED_FILE_TYPES.includes(fileType)) {
      throw new Error(
        `Unsupported file type: ${fileType}. Supported types: ${this.SUPPORTED_FILE_TYPES.join(', ')}`
      );
    }

    if (fileSize > this.MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${fileSize} bytes. Maximum size: ${this.MAX_FILE_SIZE} bytes`
      );
    }
  }

  /**
   * Generate SHA-256 hash of file content for duplicate detection
   */
  static generateFileHash(fileBuffer) {
    console.log('🔑 Generating file hash...');
    console.log(`📁 File Size: ${fileBuffer.length} bytes`);

    const hash = crypto.createHash('sha256');
    hash.update(fileBuffer);
    const fileHash = hash.digest('hex');

    console.log(`🔑 Generated hash: ${fileHash.substring(0, 16)}...`);
    return fileHash;
  }

  /**
   * Check if document with same hash or name already exists for this agent
   */
  static async checkForDuplicate(agentId, fileHash, fileName) {
    console.log('🔍 Checking for duplicate file...');
    console.log(`📋 Agent ID: ${agentId}`);
    console.log(`🔑 File Hash: ${fileHash.substring(0, 16)}...`);
    if (fileName) {
      console.log(`📁 File Name: ${fileName}`);
    }

    // Check by file hash first (most reliable)
    const { data: hashData, error: hashError } = await getSupabaseClient()
      .from('knowledge_chunks')
      .select('id, file_name, created_at')
      .eq('agent_id', agentId)
      .eq('file_hash', fileHash)
      .limit(5);

    if (hashError) {
      console.error('❌ Error checking for duplicate by hash:', hashError);
    } else if (hashData && hashData.length > 0) {
      console.log(`⚠️  Found ${hashData.length} existing chunks with same hash:`);
      hashData.forEach((chunk, index) => {
        console.log(`  ${index + 1}. File: ${chunk.file_name}, Created: ${chunk.created_at}`);
      });
      return true;
    }

    // Also check by file name if provided
    if (fileName) {
      const { data: nameData, error: nameError } = await getSupabaseClient()
        .from('knowledge_chunks')
        .select('id, file_name, created_at')
        .eq('agent_id', agentId)
        .eq('file_name', fileName)
        .limit(5);

      if (nameError) {
        console.error('❌ Error checking for duplicate by name:', nameError);
      } else if (nameData && nameData.length > 0) {
        console.log(`⚠️  Found ${nameData.length} existing chunks with same file name:`);
        nameData.forEach((chunk, index) => {
          console.log(`  ${index + 1}. File: ${chunk.file_name}, Created: ${chunk.created_at}`);
        });
        return true;
      }
    }

    console.log('✅ No duplicates found, proceeding with upload');
    return false;
  }

  /**
   * Remove image references and other non-text content from extracted text
   */
  static removeImageReferences(text) {
    const originalLength = text.length;

    // Remove common image references and placeholders
    const imagePatterns = [
      /\[Image\]/gi,
      /\[Picture\]/gi,
      /\[Figure \d+\]/gi,
      /\[Chart\]/gi,
      /\[Graph\]/gi,
      /\[Diagram\]/gi,
      /\[Screenshot\]/gi,
      /\[Photo\]/gi,
      /\[Illustration\]/gi,
      /\[Logo\]/gi,
      /\[Banner\]/gi,
      /\[Header Image\]/gi,
      /\[Footer Image\]/gi,
      /\[Background Image\]/gi,
      // Remove base64 image data
      /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
      // Remove image file references
      /\.(jpg|jpeg|png|gif|bmp|svg|webp|tiff|ico)(\?[^\s]*)?/gi,
      // Remove empty lines that might be left after image removal
      /\n\s*\n\s*\n/g,
      // Remove excessive whitespace
      /\s{3,}/g
    ];

    let cleanedText = text;
    let totalRemoved = 0;

    for (const pattern of imagePatterns) {
      const beforeLength = cleanedText.length;
      cleanedText = cleanedText.replace(pattern, '');
      totalRemoved += (beforeLength - cleanedText.length);
    }

    // Clean up any remaining artifacts
    cleanedText = cleanedText
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Replace multiple newlines with double newlines
      .replace(/^\s+|\s+$/g, '') // Trim whitespace
      .replace(/\s{2,}/g, ' '); // Replace multiple spaces with single space

    const finalLength = cleanedText.length;
    const removedChars = originalLength - finalLength;

    if (removedChars > 0) {
      console.log(`Image filtering: Removed ${removedChars} characters of image-related content (${originalLength} → ${finalLength} chars)`);
    }

    return cleanedText;
  }

  /**
   * Extract text content from various file types
   */
  static async extractTextFromFile(fileBuffer, fileType) {
    switch (fileType) {
      case 'text/plain':
      case 'text/markdown':
      case 'text/csv':
      case 'application/json':
      case 'application/xml':
      case 'text/xml':
        const rawText = fileBuffer.toString('utf-8');
        return this.removeImageReferences(rawText);

      case 'application/pdf':
        try {
          const pdfData = await pdfParse(fileBuffer);
          return this.removeImageReferences(pdfData.text);
        } catch (error) {
          throw new Error(`Failed to process PDF: ${error.message}`);
        }

      case 'application/msword':
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        try {
          const result = await mammoth.extractRawText({ buffer: fileBuffer });
          let text = result.value;
          text = this.removeImageReferences(text);
          return text;
        } catch (error) {
          throw new Error(`Failed to process Word document: ${error.message}`);
        }

      // Microsoft Excel files
      case 'application/vnd.ms-excel':
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        try {
          const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
          let text = '';

          workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const sheetData = XLSX.utils.sheet_to_csv(worksheet);
            text += `Sheet: ${sheetName}\n${sheetData}\n\n`;
          });

          return this.removeImageReferences(text);
        } catch (error) {
          throw new Error(`Failed to process Excel file: ${error.message}`);
        }

      // Microsoft PowerPoint files (temporarily disabled)
      case 'application/vnd.ms-powerpoint':
      case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        throw new Error('PowerPoint processing is temporarily disabled. Please convert to text format.');

      // RTF files (temporarily disabled)
      case 'text/rtf':
      case 'application/rtf':
      case 'text/richtext':
        throw new Error('RTF processing is temporarily disabled. Please convert to text format.');

      // OpenDocument formats
      case 'application/vnd.oasis.opendocument.text':
      case 'application/vnd.oasis.opendocument.spreadsheet':
      case 'application/vnd.oasis.opendocument.presentation':
        try {
          const text = await this.parseOpenDocument(fileBuffer);
          return this.removeImageReferences(text);
        } catch (error) {
          throw new Error(`Failed to process OpenDocument file: ${error.message}`);
        }

      default:
        // Try to decode as text for other types
        try {
          const text = fileBuffer.toString('utf-8');
          return this.removeImageReferences(text);
        } catch (error) {
          throw new Error(`Unsupported file type: ${fileType}. Please convert to a supported format.`);
        }
    }
  }

  /**
   * Parse OpenDocument files (ODT, ODS, ODP) to extract text content
   */
  static async parseOpenDocument(fileBuffer) {
    try {
      const text = fileBuffer.toString('utf-8', { ignoreBOM: true });

      // Extract text between XML tags (basic approach)
      const textMatches = text.match(/<text:p[^>]*>(.*?)<\/text:p>/g);
      if (textMatches) {
        return textMatches
          .map(match => match.replace(/<[^>]*>/g, '')) // Remove XML tags
          .join('\n');
      }

      // Fallback: try to extract any readable text
      return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    } catch (error) {
      throw new Error(`Failed to parse OpenDocument: ${error.message}`);
    }
  }

  /**
   * Chunk text into optimal sizes for embedding
   */
  static async chunkText(text, options) {
    // Simple token estimation: ~4 characters per token
    const charsPerToken = 4;
    const minChars = options.minTokens * charsPerToken;
    const maxChars = Math.min(options.maxTokens * charsPerToken, this.MAX_CHARS_PER_CHUNK);
    const overlapChars = options.overlapTokens * charsPerToken;

    console.log(`Chunking options: minChars=${minChars}, maxChars=${maxChars}, overlapChars=${overlapChars}, maxCharsLimit=${this.MAX_CHARS_PER_CHUNK}`);

    // Split by paragraphs first
    const paragraphs = text
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    console.log(`Found ${paragraphs.length} paragraphs`);

    const chunks = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      // If paragraph itself is too large, split it further
      if (paragraph.length > this.MAX_CHARS_PER_CHUNK) {
        console.log(`Large paragraph detected (${paragraph.length} chars), splitting further...`);

        // Save current chunk if it exists
        if (currentChunk.trim().length >= minChars) {
          chunks.push(currentChunk.trim());
          console.log(`Added chunk of length ${currentChunk.length}`);
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
          console.log(`Added chunk of length ${currentChunk.length}`);
        } else {
          console.log(`Skipped chunk of length ${currentChunk.length} (below minimum ${minChars})`);
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
      console.log(`Added final chunk of length ${currentChunk.length}`);
    } else {
      console.log(`Skipped final chunk of length ${currentChunk.length} (below minimum ${minChars})`);
    }

    // If no chunks were created (very short content), create one chunk
    if (chunks.length === 0 && text.trim().length > 0) {
      chunks.push(text.trim());
      console.log(`Created single chunk for short content of length ${text.trim().length}`);
    }

    // Final safety check: ensure no chunk exceeds the API limit
    const finalChunks = chunks.map(chunk => {
      if (chunk.length > this.MAX_CHARS_PER_CHUNK) {
        console.log(`⚠️  Chunk too large (${chunk.length} chars), splitting further...`);
        return this.splitLargeText(chunk, maxChars, overlapChars);
      }
      return [chunk];
    }).flat();

    console.log(`Final chunking result: ${finalChunks.length} chunks`);
    finalChunks.forEach((chunk, index) => {
      console.log(`  Chunk ${index + 1}: ${chunk.length} characters`);
    });

    return finalChunks;
  }

  /**
   * Split large text into smaller chunks
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
        console.log(`  Split chunk: ${chunk.length} characters`);
      }

      // Move start position with overlap
      start = Math.max(start + 1, end - overlapChars);
    }

    return chunks;
  }

  /**
   * Process chunks: generate embeddings and create knowledge chunk objects
   */
  static async processChunks(chunks, fileName, fileType, fileSize, agentId, fileHash) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

    const knowledgeChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      try {
        // Generate embedding
        const result = await model.embedContent(chunk);
        const embedding = result.embedding.values;

        knowledgeChunks.push({
          agent_id: agentId,
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
            token_estimate: Math.ceil(chunk.length / 4) // Rough token estimation
          }
        });
      } catch (error) {
        console.error(`Error processing chunk ${i}:`, error);
        // Continue with other chunks even if one fails
      }
    }

    return knowledgeChunks;
  }

  /**
   * Store knowledge chunks in database
   */
  static async storeChunks(chunks) {
    if (chunks.length === 0) {
      return [];
    }

    const { data, error } = await getSupabaseClient()
      .from('knowledge_chunks')
      .insert(chunks)
      .select();

    if (error) {
      throw new Error(`Failed to store knowledge chunks: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get processing statistics for an agent
   */
  static async getProcessingStats(agentId) {
    const { data, error } = await getSupabaseClient()
      .from('knowledge_chunks')
      .select('file_name, file_size, created_at')
      .eq('agent_id', agentId);

    if (error) {
      throw new Error(`Failed to get processing stats: ${error.message}`);
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
   * Delete all chunks for a specific file
   */
  static async deleteFileChunks(agentId, fileHash) {
    const { error } = await getSupabaseClient()
      .from('knowledge_chunks')
      .delete()
      .eq('agent_id', agentId)
      .eq('file_hash', fileHash);

    if (error) {
      throw new Error(`Failed to delete file chunks: ${error.message}`);
    }
  }
}

module.exports = KnowledgeIngestionService;
