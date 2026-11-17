// F344 T5: the one seam a streaming transcription provider would replace.
// A transcriber takes a captured piece and a session id and returns the text
// heard in it. The chunked route posts each piece to the factcheck function.
// Silent pieces are sent too (the server skips the provider call) so that the
// session stays alive.

export function createTranscriber(client) {
  return {
    async transcribe(piece, sessionId, { signal } = {}) {
      const reply = await client.transcribe({
        session_id: sessionId, seq: piece.seq, file: piece.wav, signal,
        pieceNo: piece.pieceNo, posStartS: piece.posStartS, posEndS: piece.posEndS,
      });
      return {
        seq: reply?.seq ?? piece.seq,
        text: typeof reply?.text === 'string' ? reply.text : '',
        secondsLeft: reply?.seconds_left,
        ...(reply?.stored === undefined ? {} : { stored: reply.stored === true }),
      };
    },
  };
}
