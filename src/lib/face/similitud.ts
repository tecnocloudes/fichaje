/**
 * Similitud coseno entre dos embeddings faciales (Float32Array).
 * Devuelve un valor en [0, 1] (clamped). 1 = idéntico, 0 = ortogonal.
 *
 * Para face-api.js (Inception ResNet V1, embedding 128-D L2-normalizado),
 * un umbral típico de match seguro es >= 0.6. Por debajo, no match.
 */

export const FACE_MATCH_THRESHOLD = 0.6;

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Embeddings de dimensiones distintas: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  // Clamp a [0,1] (algunos embeddings pueden ser ligeramente negativos
  // por ruido si no están perfectamente L2-normalizados).
  return Math.max(0, Math.min(1, sim));
}
