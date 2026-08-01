export const findIdempotentAnnotation = (annotations, authorId, clientRequestId) => {
  if (!clientRequestId) return null;
  return (annotations || []).find((annotation) => annotation.authorId === authorId && annotation.clientRequestId === clientRequestId) || null;
};
