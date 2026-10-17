require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const DB_NAME = require("../src/database-config").databaseName();
if (process.env.AI_ENABLED === "1" && !/^linan_ai_/.test(DB_NAME)) {
  throw new Error("AI 升级版只允许初始化独立 linan_ai_ 数据库");
}

if (!/^[A-Za-z0-9_]+$/.test(DB_NAME)) {
  throw new Error("DB_NAME 只能包含字母、数字和下划线");
}

async function columnExists(connection, table, column) {
  const [[row]] = await connection.execute(
    `SELECT COUNT(*) total FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [DB_NAME, table, column],
  );
  return Number(row.total) > 0;
}

async function indexExists(connection, table, index) {
  const [[row]] = await connection.execute(
    `SELECT COUNT(*) total FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?`,
    [DB_NAME, table, index],
  );
  return Number(row.total) > 0;
}

async function constraintExists(connection, table, constraint) {
  const [[row]] = await connection.execute(
    `SELECT COUNT(*) total FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME=?`,
    [DB_NAME, table, constraint],
  );
  return Number(row.total) > 0;
}

async function columnType(connection, table, column) {
  const [[row]] = await connection.execute(
    `SELECT COLUMN_TYPE columnType FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [DB_NAME, table, column],
  );
  return row?.columnType || "";
}

async function migrateUserRoles(connection) {
  const roleType = await columnType(connection, "users", "role");
  if (!roleType) return;

  if (roleType.includes("'elder'") || roleType.includes("'worker'")) {
    await connection.query(
      "ALTER TABLE users MODIFY role ENUM('admin','elder','worker','family','caregiver') NOT NULL",
    );
    await connection.query("UPDATE users SET role='family' WHERE role='elder'");
    await connection.query(
      "UPDATE users SET role='caregiver' WHERE role='worker'",
    );
  }

  const canonicalRoleType = await columnType(connection, "users", "role");
  if (canonicalRoleType !== "enum('admin','family','caregiver')") {
    const [[unexpected]] = await connection.query(
      "SELECT role FROM users WHERE role NOT IN ('admin','family','caregiver') LIMIT 1",
    );
    if (unexpected) {
      throw new Error(`发现无法迁移的用户角色：${unexpected.role}`);
    }
    await connection.query(
      "ALTER TABLE users MODIFY role ENUM('admin','family','caregiver') NOT NULL",
    );
  }
}

async function migrateDemoUsername(connection, oldUsername, newUsername) {
  const [[legacy]] = await connection.execute(
    "SELECT id FROM users WHERE username=? LIMIT 1",
    [oldUsername],
  );
  if (!legacy) return false;

  const [[current]] = await connection.execute(
    "SELECT id FROM users WHERE username=? LIMIT 1",
    [newUsername],
  );
  if (current) {
    console.warn(
      `检测到旧演示账号 ${oldUsername}，但 ${newUsername} 已存在；为避免破坏关联数据，保留旧账号。`,
    );
    return false;
  }

  await connection.execute("UPDATE users SET username=? WHERE id=?", [
    newUsername,
    legacy.id,
  ]);
  return true;
}

async function migrate(connection) {
  await migrateUserRoles(connection);

  const columns = [
    [
      "users",
      "updated_at",
      "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    ],
    [
      "elder_profiles",
      "updated_at",
      "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    ],
    [
      "service_items",
      "updated_at",
      "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    ],
    [
      "service_orders",
      "service_name_snapshot",
      "VARCHAR(100) DEFAULT NULL AFTER service_id",
    ],
    [
      "service_orders",
      "service_category_snapshot",
      "VARCHAR(50) DEFAULT NULL AFTER service_name_snapshot",
    ],
    [
      "service_orders",
      "service_price_snapshot",
      "DECIMAL(10,2) DEFAULT NULL AFTER service_category_snapshot",
    ],
    [
      "service_orders",
      "service_duration_snapshot",
      "INT DEFAULT NULL AFTER service_price_snapshot",
    ],
    [
      "service_orders",
      "evaluated_at",
      "DATETIME DEFAULT NULL AFTER evaluation",
    ],
    [
      "service_orders",
      "updated_at",
      "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    ],
    [
      "notices",
      "updated_at",
      "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    ],
    [
      "emergency_calls",
      "handling_note",
      "VARCHAR(500) DEFAULT NULL AFTER status",
    ],
    ["emergency_calls", "handled_by", "INT DEFAULT NULL AFTER handling_note"],
    [
      "emergency_calls",
      "updated_at",
      "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at",
    ],
    ["emergency_calls", "handled_at", "DATETIME DEFAULT NULL AFTER updated_at"],
  ];
  for (const [table, column, definition] of columns) {
    if (!(await columnExists(connection, table, column))) {
      await connection.query(
        `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`,
      );
    }
  }

  const emergencyStatusType = await columnType(
    connection,
    "emergency_calls",
    "status",
  );
  if (
    emergencyStatusType &&
    (!emergencyStatusType.includes("'处理中'") ||
      !emergencyStatusType.includes("'已解决'"))
  ) {
    await connection.query(
      "ALTER TABLE emergency_calls MODIFY status ENUM('待处理','处理中','已解决','已处理','已受理') NOT NULL DEFAULT '待处理'",
    );
    await connection.query(
      "UPDATE emergency_calls SET status='处理中' WHERE status='已受理'",
    );
    await connection.query(
      "UPDATE emergency_calls SET status='已解决' WHERE status='已处理'",
    );
    await connection.query(
      "ALTER TABLE emergency_calls MODIFY status ENUM('待处理','处理中','已解决') NOT NULL DEFAULT '待处理'",
    );
  }

  if (
    !(await constraintExists(
      connection,
      "emergency_calls",
      "fk_emergency_handler",
    ))
  ) {
    await connection.query(
      "ALTER TABLE emergency_calls ADD CONSTRAINT fk_emergency_handler FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL",
    );
  }

  const indexes = [
    ["users", "idx_users_role_status", "(role, status)"],
    ["users", "idx_users_real_name", "(real_name)"],
    ["service_items", "idx_service_status_category", "(status, category)"],
    ["service_items", "idx_service_name", "(name)"],
    [
      "service_orders",
      "idx_order_elder_status_created",
      "(elder_id, status, created_at)",
    ],
    [
      "service_orders",
      "idx_order_worker_status_created",
      "(worker_id, status, created_at)",
    ],
    [
      "service_orders",
      "idx_order_service_appointment",
      "(service_id, appointment_time)",
    ],
    [
      "service_orders",
      "idx_order_status_appointment",
      "(status, appointment_time)",
    ],
    ["notices", "idx_notice_created", "(created_at)"],
    ["emergency_calls", "idx_emergency_status_created", "(status, created_at)"],
    [
      "emergency_calls",
      "idx_emergency_elder_created",
      "(elder_id, created_at)",
    ],
  ];
  for (const [table, index, definition] of indexes) {
    if (!(await indexExists(connection, table, index))) {
      await connection.query(
        `ALTER TABLE \`${table}\` ADD INDEX \`${index}\` ${definition}`,
      );
    }
  }

  await connection.query(`
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
    ) ENGINE=InnoDB
  `);

  await connection.query(`
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
    ) ENGINE=InnoDB
  `);

  await connection.query(`
    UPDATE service_orders o
    JOIN service_items s ON s.id=o.service_id
    SET o.service_name_snapshot=COALESCE(o.service_name_snapshot,s.name),
        o.service_category_snapshot=COALESCE(o.service_category_snapshot,s.category),
        o.service_price_snapshot=COALESCE(o.service_price_snapshot,s.price),
        o.service_duration_snapshot=COALESCE(o.service_duration_snapshot,s.duration_minutes)
    WHERE o.service_name_snapshot IS NULL OR o.service_category_snapshot IS NULL
       OR o.service_price_snapshot IS NULL OR o.service_duration_snapshot IS NULL
  `);

  await connection.query(`
    INSERT INTO order_status_logs (order_id, from_status, to_status, operator_id, action_note, created_at)
    SELECT o.id, NULL, o.status, NULL, '历史订单状态初始化', o.created_at
    FROM service_orders o
    WHERE NOT EXISTS (SELECT 1 FROM order_status_logs l WHERE l.order_id=o.id)
  `);
  await connection.query(`
    INSERT INTO emergency_status_logs (emergency_id, from_status, to_status, operator_id, action_note, created_at)
    SELECT e.id, NULL, e.status, e.handled_by, '历史求助状态初始化', e.created_at
    FROM emergency_calls e
    WHERE NOT EXISTS (SELECT 1 FROM emergency_status_logs l WHERE l.emergency_id=e.id)
  `);
  await connection.query(
    "UPDATE emergency_calls SET handled_at=COALESCE(handled_at, updated_at) WHERE status='已解决' AND handled_at IS NULL",
  );
}

async function init() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true,
    charset: "utf8mb4",
  });

  try {
    const source = fs.readFileSync(
      path.join(__dirname, "../database/schema.sql"),
      "utf8",
    );
    const schema = source.replaceAll("linan_ai_api", DB_NAME);
    await connection.query(schema);
    await connection.changeUser({ database: DB_NAME });
    await migrate(connection);

    const renamedDemoAccounts = new Set();
    if (await migrateDemoUsername(connection, "elder", "family"))
      renamedDemoAccounts.add("family");
    if (await migrateDemoUsername(connection, "worker", "caregiver"))
      renamedDemoAccounts.add("caregiver");

    const accounts = [
      ["admin", "admin123", "系统管理员", "13800000001", "admin"],
      ["family", "family123", "张建国", "13800000002", "family"],
      ["caregiver", "caregiver123", "李晓梅", "13800000003", "caregiver"],
    ];
    for (const [username, password, realName, phone, role] of accounts) {
      const hash = await bcrypt.hash(password, 10);
      await connection.execute(
        `INSERT INTO users (username, password_hash, real_name, phone, role)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE real_name=VALUES(real_name), phone=VALUES(phone), role=VALUES(role)`,
        [username, hash, realName, phone, role],
      );
      if (renamedDemoAccounts.has(username)) {
        await connection.execute(
          "UPDATE users SET password_hash=? WHERE username=?",
          [hash, username],
        );
      }
    }

    const [[elder]] = await connection.execute(
      "SELECT id FROM users WHERE username=?",
      ["family"],
    );
    const [[admin]] = await connection.execute(
      "SELECT id FROM users WHERE username=?",
      ["admin"],
    );
    await connection.execute(
      `INSERT INTO elder_profiles
        (user_id, gender, birth_date, address, emergency_contact, emergency_phone, health_notes)
       VALUES (?, '男', '1952-06-18', '邻安社区幸福路8号2单元301室', '张敏', '13900001001', '患有轻度高血压，需定期测量血压')
       ON DUPLICATE KEY UPDATE address=VALUES(address)`,
      [elder.id],
    );

    const services = [
      ["生活照料", "上门服务", "协助老人进行居家清洁、整理和日常照料", 35, 60],
      ["助餐送餐", "助餐服务", "提供营养搭配的社区午餐并送餐上门", 18, 30],
      ["健康监测", "健康服务", "上门测量血压、血糖并记录健康情况", 25, 30],
      ["陪诊服务", "医疗协助", "陪同老人前往医院挂号、检查和取药", 80, 120],
      ["心理慰藉", "精神关怀", "上门陪伴聊天，了解老人心理和生活状况", 20, 60],
    ];
    for (const item of services) {
      await connection.execute(
        `INSERT INTO service_items (name, category, description, price, duration_minutes)
         SELECT ?, ?, ?, ?, ? FROM DUAL
         WHERE NOT EXISTS (SELECT 1 FROM service_items WHERE name=?)`,
        [...item, item[0]],
      );
    }

    await connection.execute(
      `INSERT INTO notices (title, content, publisher_id)
       SELECT '邻安社区秋季健康讲座', '本周六上午九点在社区活动中心开展老年人秋季健康知识讲座，欢迎居民参加。', ?
       FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notices WHERE title='邻安社区秋季健康讲座')`,
      [admin.id],
    );

    console.log("数据库结构迁移与初始化完成。");
    console.log("管理员：admin / admin123");
    console.log("家属：family / family123");
    console.log("护理人员：caregiver / caregiver123");
  } finally {
    await connection.end();
  }
}

init().catch((error) => {
  console.error("数据库初始化失败：", error.message);
  process.exit(1);
});
