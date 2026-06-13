export function encodeWav16({
  format,
  sampleRate,
  numChannels,
  bitDepth,
  samples,
}: {
  format: number;
  sampleRate: number;
  numChannels: number;
  bitDepth: number;
  samples: Int16Array;
}) {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * blockAlign, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, blockAlign, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * bytesPerSample, true);
  writeInt16(view, 44, samples);
  return buffer;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function writeInt16(output: DataView, offset: number, input: Int16Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    output.setInt16(offset, input[i]!, true);
  }
}

/**
 * Information extracted from a WAV file header
 */
export interface WAVInfo {
  /** Byte offset where audio data begins */
  dataOffset: number;
  /** Size of audio data in bytes */
  dataSize: number;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Number of audio channels */
  numChannels: number;
  /** Bits per sample (e.g., 16 for PCM16) */
  bitsPerSample: number;
}

/**
 * Parse a WAV file header and return information about the audio data.
 *
 * This function properly handles variable-length WAV headers by searching
 * for the 'data' chunk instead of assuming a fixed 44-byte header.
 *
 * @param buffer - The WAV file data (Buffer or Uint8Array)
 * @returns WAVInfo object with data offset, size, and format info
 * @throws Error if the buffer is not a valid WAV file
 */
export function parseWAVHeader(buffer: Uint8Array | ArrayBuffer): WAVInfo {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Verify RIFF header
  const riff = readString(view, 0, 4);
  if (riff !== 'RIFF') {
    throw new Error('Not a valid WAV file: missing RIFF header');
  }

  // Verify WAVE format
  const wave = readString(view, 8, 4);
  if (wave !== 'WAVE') {
    throw new Error('Not a valid WAV file: missing WAVE format');
  }

  // Parse chunks to find 'fmt ' and 'data'
  let offset = 12;
  let sampleRate = 0;
  let numChannels = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < bytes.length - 8) {
    const chunkId = readString(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      // Format chunk - extract audio format info
      // Format chunk layout:
      // +0: Audio format (2 bytes) - 1 = PCM
      // +2: Num channels (2 bytes)
      // +4: Sample rate (4 bytes)
      // +8: Byte rate (4 bytes)
      // +12: Block align (2 bytes)
      // +14: Bits per sample (2 bytes)
      numChannels = view.getUint16(offset + 8 + 2, true);
      sampleRate = view.getUint32(offset + 8 + 4, true);
      bitsPerSample = view.getUint16(offset + 8 + 14, true);
    } else if (chunkId === 'data') {
      // Data chunk - this is what we're looking for
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    // Move to next chunk (chunk header is 8 bytes: 4 for ID, 4 for size)
    offset += 8 + chunkSize;

    // Chunks are word-aligned (padded to even byte boundary)
    if (chunkSize % 2 !== 0) {
      offset++;
    }
  }

  if (dataOffset === 0) {
    throw new Error('WAV file missing data chunk');
  }

  return { dataOffset, dataSize, sampleRate, numChannels, bitsPerSample };
}

/**
 * Helper to read a string from DataView
 */
function readString(view: DataView, offset: number, length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += String.fromCharCode(view.getUint8(offset + i));
  }
  return result;
}
