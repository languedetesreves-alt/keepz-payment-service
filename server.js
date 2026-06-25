const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors({
  origin: "https://languedetesreves.com",
  methods: ["POST"],
}));
app.use(express.json());

const PORT = 10000;

// --- Keepz данные (берутся из Render → Environment) ---
const KEEPZ_API_URL = "https://gateway.keepz.me/ecommerce-service/api/integrator/order";
const KEEPZ_IDENTIFIER = process.env.KEEPZ_IDENTIFIER;
const KEEPZ_INTEGRATOR_ID = process.env.KEEPZ_INTEGRATOR_ID;
const KEEPZ_RECEIVER_ID = process.env.KEEPZ_RECEIVER_ID;
const KEEPZ_RSA_PUBLIC_KEY = process.env.KEEPZ_RSA_PUBLIC_KEY;
const KEEPZ_RSA_PRIVATE_KEY = process.env.KEEPZ_RSA_PRIVATE_KEY;

// Проверка сервера
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ===== Шифрование для Keepz =====
function keepzEncrypt(data) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
  const encryptedData = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(data), "utf8")),
    cipher.final(),
  ]);

  const concat = `${aesKey.toString("base64")}.${iv.toString("base64")}`;

  const rsaPublicKey = crypto.createPublicKey({
    key: Buffer.from(KEEPZ_RSA_PUBLIC_KEY, "base64"),
    format: "der",
    type: "spki",
  });

  const encryptedKeys = crypto.publicEncrypt(
    { key: rsaPublicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(concat, "utf8")
  );

  return {
    encryptedData: encryptedData.toString("base64"),
    encryptedKeys: encryptedKeys.toString("base64"),
  };
}

function keepzDecrypt(encryptedDataB64, encryptedKeysB64) {
  const rsaPrivateKey = crypto.createPrivateKey({
    key: Buffer.from(KEEPZ_RSA_PRIVATE_KEY, "base64"),
    format: "der",
    type: "pkcs8",
  });

  const decryptedConcat = crypto
    .privateDecrypt(
      { key: rsaPrivateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(encryptedKeysB64, "base64")
    )
    .toString("utf8");

  const [encodedKey, encodedIV] = decryptedConcat.split(".");
  const aesKey = Buffer.from(encodedKey, "base64");
  const iv = Buffer.from(encodedIV, "base64");

  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedDataB64, "base64")),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}

// ===== Создание заказа в Keepz =====
async function createKeepzOrder({ name, email, tariff, price, format }) {
  const integratorOrderId = uuidv4();

  const payload = {
    amount: price,
    receiverId: KEEPZ_RECEIVER_ID,
    receiverType: "BRANCH",
    integratorId: KEEPZ_INTEGRATOR_ID,
    integratorOrderId: integratorOrderId,
    currency: "USD",
    language: "EN",
    orderProperties: {
      DESCRIPTION: { value: `${format} — ${tariff} (${name}, ${email})`, isEditable: false },
    },
  };

  const encrypted = keepzEncrypt(payload);

  const response = await fetch(KEEPZ_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: KEEPZ_IDENTIFIER,
      encryptedData: encrypted.encryptedData,
      encryptedKeys: encrypted.encryptedKeys,
      aes: true,
    }),
  });

  const responseBody = await response.json();

  if (responseBody.statusCode) {
    throw new Error(`Keepz error ${responseBody.statusCode}: ${responseBody.message}`);
  }

  return keepzDecrypt(responseBody.encryptedData, responseBody.encryptedKeys);
}

// ===== Главная точка входа с сайта =====
app.post("/create-payment", async (req, res) => {
  try {
    const { name, email, tariff, price, format } = req.body;

    if (!name || !email || !tariff || !price) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["name", "email", "tariff", "price"],
      });
    }

    const result = await createKeepzOrder({ name, email, tariff, price, format });
    return res.json({
      payment_url: result.urlForQR,
      provider: "keepz",
      order_id: result.integratorOrderId,
    });
  } catch (err) {
    console.error("Payment creation error:", err.message || err);
    return res.status(500).json({ error: "Payment creation failed", details: err.message });
  }
});

// Callback от Keepz
app.post("/keepz-callback", (req, res) => {
  console.log("Callback:", req.body);
  res.json({ received: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
