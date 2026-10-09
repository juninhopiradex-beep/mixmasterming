-- Sessões da aplicação (token Bearer, sem cookies) separadas das sessões da loja (cookie HttpOnly)
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'web';
ALTER TABLE sessions ADD COLUMN machine TEXT;
