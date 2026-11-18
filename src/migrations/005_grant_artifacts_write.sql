-- Berikan scope 'artifacts:write' pada kunci API yang belum memilikinya
-- agar bot dan skrip CI dapat mempublikasikan artefak olahan ke backend secara otomatis.
UPDATE api_keys
SET scopes = 'observations:write,observations:read,artifacts:write'
WHERE scopes NOT LIKE '%artifacts:write%';

