CREATE INDEX IF NOT EXISTS annotated_records_annotation_request_idx
  ON annotated_records ((payload->>'authorId'), (payload->>'clientRequestId'))
  WHERE collection = 'annotations';
