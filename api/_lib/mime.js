'use strict';
/* Audio type, decided by looking at the bytes.

   This exists because the file extension lies. The old uploader named every clip
   `*.wav` and passed contentType:'audio/wav' regardless of what the recorder actually
   produced, so among the legacy files there are `.wav` names whose first four bytes are
   1a 45 df a3 — a Matroska/WebM header. Trusting the name means handing a browser a
   WebM stream labelled audio/wav, which some players refuse outright.

   So: the extension is never consulted, and neither is the client-supplied MIME. The
   type is derived here from the leading bytes, on write and again on read. */

/* Only the containers a phone recorder actually emits. Anything else stays unknown
   rather than being guessed into a plausible-looking wrong answer. */
function sniff(buf) {
  if (!buf || buf.length < 4) return null;

  /* EBML — Matroska / WebM. The mislabelled clips in the legacy set are these. */
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'audio/webm';

  /* RIFF....WAVE */
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    if (buf.length >= 12 &&
        buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45) return 'audio/wav';
    return 'audio/wav';
  }

  /* OggS — Ogg, usually Opus or Vorbis from Firefox. */
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'audio/ogg';

  /* fLaC */
  if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) return 'audio/flac';

  /* ISO-BMFF: ....ftyp — MP4 / M4A, what Safari's recorder produces. */
  if (buf.length >= 12 &&
      buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'audio/mp4';

  /* ID3 tag, or a bare MPEG audio frame sync (11 set bits). */
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'audio/mpeg';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg';

  return null;
}

/* Sniffing needs only the first few bytes, so decode only the first base64 block
   rather than materialising a second copy of a multi-megabyte clip. 24 base64
   characters decode to 18 bytes, which is more than any signature above reads. */
function sniffBase64(b64) {
  if (typeof b64 !== 'string' || !b64) return null;
  var head = b64.replace(/[\r\n]/g, '').slice(0, 24);
  var buf;
  try { buf = Buffer.from(head, 'base64'); } catch (e) { return null; }
  return sniff(buf);
}

/* What to store when the bytes match nothing known. Deliberately not audio/wav:
   a wrong specific type is worse than an honest generic one, because the browser
   will act on it. */
var FALLBACK = 'application/octet-stream';

module.exports = { sniff: sniff, sniffBase64: sniffBase64, FALLBACK: FALLBACK };
