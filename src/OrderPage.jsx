import { useMemo, useState } from "react";
import { createOrder } from "../api/orders";
import useMenu from "../hooks/useMenu";
import styles from "./OrderPage.module.css";

const CATEGORIES = ["All", "Starters", "Grill", "Mains", "Seafood", "Bread", "Drinks"];

export default function OrderPage() {
  const { items, loading, usingDemo } = useMenu();
  const [cart, setCart]         = useState([]);
  const [category, setCategory] = useState("All");
  const [search, setSearch]     = useState("");
  const [note, setNote]         = useState("");
  const [tableNo, setTableNo]   = useState("");
  const [placing, setPlacing]   = useState(false);
  const [receipt, setReceipt]   = useState(null);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (!item.available) return false;
      if (category !== "All" && item.category !== category) return false;
      if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [items, category, search]);

  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) => c.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      }
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const updateQty = (id, delta) => {
    setCart((prev) =>
      prev
        .map((c) => c.id === id ? { ...c, qty: c.qty + delta } : c)
        .filter((c) => c.qty > 0)
    );
  };

  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const tax      = subtotal * 0.16;  // 16% VAT (Kenya standard)
  const total    = subtotal + tax;

  const placeOrder = async () => {
    if (!cart.length) return;
    setPlacing(true);
    try {
      const payload = {
        tableNumber: tableNo || null,
        note,
        items: cart.map((c) => ({ menuItemId: c.id, quantity: c.qty, price: c.price })),
      };

      let orderData;
      if (usingDemo) {
        // Simulate backend response
        orderData = { id: Math.floor(Math.random() * 9000) + 1000, ...payload, total };
      } else {
        const { data } = await createOrder(payload);
        orderData = data;
      }

      setReceipt({ ...orderData, cart, subtotal, tax, total, tableNo });
      setCart([]);
      setNote("");
      setTableNo("");
    } catch (err) {
      alert("Failed to place order: " + (err.response?.data?.message ?? err.message));
    } finally {
      setPlacing(false);
    }
  };

  if (receipt) {
    return <ReceiptView receipt={receipt} onClose={() => setReceipt(null)} />;
  }

  return (
    <div className={styles.page}>
      {/* Menu Panel */}
      <div className={styles.menu}>
        <div className={styles.menuHeader}>
          <h2 className={styles.pageTitle}>New Order</h2>
          {usingDemo && (
            <span className="badge badge-gold">Demo Mode</span>
          )}
          <input
            className={styles.search}
            placeholder="Search menu…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className={styles.cats}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={`${styles.cat} ${category === c ? styles.catActive : ""}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>

        {loading ? (
          <div className={styles.loading}>Loading menu…</div>
        ) : (
          <div className={styles.grid}>
            {filtered.map((item) => (
              <button key={item.id} className={styles.card} onClick={() => addToCart(item)}>
                <div className={styles.cardCat}>{item.category}</div>
                <div className={styles.cardName}>{item.name}</div>
                <div className={styles.cardPrice}>${item.price.toFixed(2)}</div>
                {cart.find((c) => c.id === item.id) && (
                  <div className={styles.inCart}>
                    ×{cart.find((c) => c.id === item.id).qty}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cart Panel */}
      <div className={styles.cart}>
        <div className={styles.cartHeader}>
          <h3>Cart</h3>
          {cart.length > 0 && (
            <button className={styles.clearBtn} onClick={() => setCart([])}>Clear</button>
          )}
        </div>

        <div className={styles.tableRow}>
          <label>Table #</label>
          <input
            value={tableNo}
            onChange={(e) => setTableNo(e.target.value)}
            placeholder="e.g. 5"
            className={styles.tableInput}
          />
        </div>

        <div className={styles.cartItems}>
          {cart.length === 0 ? (
            <div className={styles.emptyCart}>Tap items to add</div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className={styles.cartItem}>
                <div className={styles.cartItemName}>{item.name}</div>
                <div className={styles.cartItemControls}>
                  <button className={styles.qtyBtn} onClick={() => updateQty(item.id, -1)}>−</button>
                  <span className={styles.qtyNum}>{item.qty}</span>
                  <button className={styles.qtyBtn} onClick={() => updateQty(item.id, +1)}>+</button>
                </div>
                <div className={styles.cartItemTotal}>${(item.price * item.qty).toFixed(2)}</div>
              </div>
            ))
          )}
        </div>

        <div className={styles.noteRow}>
          <textarea
            placeholder="Order note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={styles.noteInput}
            rows={2}
          />
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryRow}><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
          <div className={styles.summaryRow}><span>VAT (16%)</span><span>${tax.toFixed(2)}</span></div>
          <div className={`${styles.summaryRow} ${styles.totalRow}`}>
            <span>Total</span><span>${total.toFixed(2)}</span>
          </div>
        </div>

        <button
          className={styles.placeBtn}
          disabled={!cart.length || placing}
          onClick={placeOrder}
        >
          {placing ? "Placing…" : `Place Order — $${total.toFixed(2)}`}
        </button>
      </div>
    </div>
  );
}

function ReceiptView({ receipt, onClose }) {
  return (
    <div className={styles.receiptWrap}>
      <div className={styles.receipt}>
        <div className={styles.receiptLogo}>🏕️</div>
        <h2 className={styles.receiptTitle}>Swahili Tent Village</h2>
        <p className={styles.receiptSub}>ORDER #{receipt.id}</p>
        {receipt.tableNo && <p className={styles.receiptTable}>Table {receipt.tableNo}</p>}

        <div className={styles.receiptDivider} />

        {receipt.cart.map((item) => (
          <div key={item.id} className={styles.receiptLine}>
            <span>{item.qty}× {item.name}</span>
            <span>${(item.price * item.qty).toFixed(2)}</span>
          </div>
        ))}

        <div className={styles.receiptDivider} />

        <div className={styles.receiptLine}>
          <span>Subtotal</span><span>${receipt.subtotal.toFixed(2)}</span>
        </div>
        <div className={styles.receiptLine}>
          <span>VAT 16%</span><span>${receipt.tax.toFixed(2)}</span>
        </div>
        <div className={`${styles.receiptLine} ${styles.receiptTotal}`}>
          <span>TOTAL</span><span>${receipt.total.toFixed(2)}</span>
        </div>

        <p className={styles.receiptThanks}>Asante sana! 🙏</p>

        <button className={styles.newOrderBtn} onClick={onClose}>New Order</button>
      </div>
    </div>
  );
}