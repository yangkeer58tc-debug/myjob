// Extract plain text from PDF/DOCX for RMC /ai-extract. Images return mode
// "image" so the caller can send multimodal base64 instead of OCR here.
import { Buffer } from 'node:buffer';
import pdfParse from 'npm:pdf-parse@1.1.1';

export type ExtractMode = 'text' | 'image';

export async function extractResumePlainText(
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<{ text: string; mode: ExtractMode }> {
  const m = mime.toLowerCase();
  const fn = filename.toLowerCase();

  if (m.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(fn)) {
    return { text: '', mode: 'image' };
  }

  if (m.includes('pdf') || fn.endsWith('.pdf')) {
    try {
      const data = await pdfParse(Buffer.from(bytes));
      return { text: String(data.text ?? '').trim(), mode: 'text' };
    } catch {
      return { text: '', mode: 'text' };
    }
  }

  if (m.includes('wordprocessingml') || fn.endsWith('.docx')) {
    try {
      const mammoth = await import('npm:mammoth@1.8.0');
      const res = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return { text: String(res.value ?? '').trim(), mode: 'text' };
    } catch {
      return { text: '', mode: 'text' };
    }
  }

  if (m.includes('msword') || fn.endsWith('.doc')) {
    try {
      const mammoth = await import('npm:mammoth@1.8.0');
      const res = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return { text: String(res.value ?? '').trim(), mode: 'text' };
    } catch {
      return { text: '', mode: 'text' };
    }
  }

  return { text: '', mode: 'text' };
}
