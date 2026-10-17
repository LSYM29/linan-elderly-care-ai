-- Only execute against the independent AI development database.
CREATE TABLE IF NOT EXISTS ai_documents (
 id INT PRIMARY KEY AUTO_INCREMENT, title VARCHAR(150) NOT NULL,
 content MEDIUMTEXT NOT NULL, region VARCHAR(80) NOT NULL DEFAULT '通用',
 published_on DATE NULL, expires_on DATE NULL, status TINYINT NOT NULL DEFAULT 1,
 version INT NOT NULL DEFAULT 1, content_hash CHAR(64) NOT NULL,
 created_by INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ai_chunks (
 id INT PRIMARY KEY AUTO_INCREMENT, document_id INT NOT NULL, ordinal INT NOT NULL,
 section_title VARCHAR(200) NOT NULL, content TEXT NOT NULL,
 UNIQUE KEY uq_chunk_position(document_id,ordinal),
 FOREIGN KEY(document_id) REFERENCES ai_documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ai_sessions (
 id CHAR(36) PRIMARY KEY, user_id INT NOT NULL, title VARCHAR(80) NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY idx_ai_session_user(user_id,updated_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ai_messages (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, session_id CHAR(36) NOT NULL,
 role ENUM('user','assistant') NOT NULL, content TEXT NOT NULL, payload JSON NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ai_runs (
 id CHAR(36) PRIMARY KEY, user_id INT NOT NULL, session_id CHAR(36) NULL,
 model VARCHAR(80) NOT NULL, prompt_version VARCHAR(40) NOT NULL, knowledge_version CHAR(64) NOT NULL,
 question VARCHAR(2000) NOT NULL, trace JSON NOT NULL, answer TEXT NULL,
 elapsed_ms INT NOT NULL, usage_json JSON NULL, status VARCHAR(20) NOT NULL,
 error_code VARCHAR(80) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 KEY idx_ai_runs_user(user_id,created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ai_action_drafts (
 id CHAR(36) PRIMARY KEY, user_id INT NOT NULL, service_id INT NOT NULL,
 service_snapshot JSON NOT NULL, appointment_time DATETIME NOT NULL,
 service_address VARCHAR(255) NOT NULL, remark VARCHAR(500) NULL,
 revision INT NOT NULL DEFAULT 1, expires_at DATETIME NOT NULL,
 status ENUM('pending','submitted','cancelled') NOT NULL DEFAULT 'pending',
 order_id INT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(order_id) REFERENCES service_orders(id), KEY idx_draft_user(user_id,created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ai_eval_cases (
 id INT PRIMARY KEY AUTO_INCREMENT, case_key VARCHAR(80) NOT NULL UNIQUE,
 category VARCHAR(40) NOT NULL, question VARCHAR(2000) NOT NULL,
 expected_json JSON NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ai_eval_results (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, evaluation_id CHAR(36) NOT NULL,
 case_id INT NOT NULL, run_id CHAR(36) NULL, model VARCHAR(80) NOT NULL,
 passed TINYINT NOT NULL, actual_json JSON NOT NULL, elapsed_ms INT NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(case_id) REFERENCES ai_eval_cases(id), KEY idx_eval_group(evaluation_id)
) ENGINE=InnoDB;
