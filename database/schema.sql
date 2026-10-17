CREATE DATABASE IF NOT EXISTS linan_ai_api
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE linan_ai_api;

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  real_name VARCHAR(50) NOT NULL,
  phone VARCHAR(20),
  role ENUM('admin', 'family', 'caregiver') NOT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_users_role_status (role, status),
  KEY idx_users_real_name (real_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS elder_profiles (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL UNIQUE,
  gender ENUM('男', '女') DEFAULT NULL,
  birth_date DATE DEFAULT NULL,
  address VARCHAR(255),
  emergency_contact VARCHAR(50),
  emergency_phone VARCHAR(20),
  health_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_elder_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS service_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  description VARCHAR(500),
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  duration_minutes INT NOT NULL DEFAULT 60,
  status TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_service_status_category (status, category),
  KEY idx_service_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS service_orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_no VARCHAR(30) NOT NULL UNIQUE,
  elder_id INT NOT NULL,
  service_id INT NOT NULL,
  service_name_snapshot VARCHAR(100) DEFAULT NULL,
  service_category_snapshot VARCHAR(50) DEFAULT NULL,
  service_price_snapshot DECIMAL(10,2) DEFAULT NULL,
  service_duration_snapshot INT DEFAULT NULL,
  worker_id INT DEFAULT NULL,
  appointment_time DATETIME NOT NULL,
  service_address VARCHAR(255) NOT NULL,
  remark VARCHAR(500),
  status ENUM('待接单', '已接单', '服务中', '已完成', '已取消') NOT NULL DEFAULT '待接单',
  service_record TEXT,
  rating TINYINT DEFAULT NULL,
  evaluation VARCHAR(500),
  evaluated_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_elder FOREIGN KEY (elder_id) REFERENCES users(id),
  CONSTRAINT fk_order_service FOREIGN KEY (service_id) REFERENCES service_items(id),
  CONSTRAINT fk_order_worker FOREIGN KEY (worker_id) REFERENCES users(id),
  KEY idx_order_elder_status_created (elder_id, status, created_at),
  KEY idx_order_worker_status_created (worker_id, status, created_at),
  KEY idx_order_service_appointment (service_id, appointment_time),
  KEY idx_order_status_appointment (status, appointment_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_status_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  from_status VARCHAR(20) DEFAULT NULL,
  to_status VARCHAR(20) NOT NULL,
  operator_id INT DEFAULT NULL,
  action_note VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_log_order FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_log_operator FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_order_log_order_created (order_id, created_at),
  KEY idx_order_log_operator (operator_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notices (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(150) NOT NULL,
  content TEXT NOT NULL,
  publisher_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notice_publisher FOREIGN KEY (publisher_id) REFERENCES users(id),
  KEY idx_notice_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS emergency_calls (
  id INT PRIMARY KEY AUTO_INCREMENT,
  elder_id INT NOT NULL,
  location VARCHAR(255),
  description VARCHAR(500),
  status ENUM('待处理', '处理中', '已解决') NOT NULL DEFAULT '待处理',
  handling_note VARCHAR(500) DEFAULT NULL,
  handled_by INT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  handled_at DATETIME DEFAULT NULL,
  CONSTRAINT fk_emergency_elder FOREIGN KEY (elder_id) REFERENCES users(id),
  CONSTRAINT fk_emergency_handler FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_emergency_status_created (status, created_at),
  KEY idx_emergency_elder_created (elder_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS emergency_status_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  emergency_id INT NOT NULL,
  from_status VARCHAR(20) DEFAULT NULL,
  to_status VARCHAR(20) NOT NULL,
  operator_id INT DEFAULT NULL,
  action_note VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_emergency_log_call FOREIGN KEY (emergency_id) REFERENCES emergency_calls(id) ON DELETE CASCADE,
  CONSTRAINT fk_emergency_log_operator FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_emergency_log_call_created (emergency_id, created_at),
  KEY idx_emergency_log_operator (operator_id)
) ENGINE=InnoDB;
