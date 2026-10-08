-- Recuperação administrativa pode repor o contador de mudanças de computador sem apagar o histórico
ALTER TABLE licenses ADD COLUMN transfer_reset_at INTEGER;
