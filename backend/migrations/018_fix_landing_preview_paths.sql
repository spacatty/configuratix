-- Fix landing preview paths from /api/landings/preview/ to /api/static/preview/
UPDATE landings 
SET preview_path = REPLACE(preview_path, '/api/landings/preview/', '/api/static/preview/')
WHERE preview_path LIKE '/api/landings/preview/%';

