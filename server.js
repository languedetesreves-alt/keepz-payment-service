const express = require("express");

const app = express();
app.use(express.json());

const PORT = 10000;

// Проверка сервера
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Создание заказа (пока тест)
app.post("/create-order", (req, res) => {
  const { order_id, customer_name, product_name, amount, currency } = req.body;

  res.json({
    success: true,
    order_id,
    payment_url: "https://test-payment-link.com"
  });
});

// Callback от платежки
app.post("/keepz-callback", (req, res) => {
  console.log("Callback:", req.body);
  res.json({ received: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});