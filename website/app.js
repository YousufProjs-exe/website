
const CONFIG = window.MERAJ_CONFIG || {};
let products = [];
let CATEGORIES = ["All"];
let activeCategory = "All";
let cart = {};
let toastTimer;

try {
  const savedCart = JSON.parse(localStorage.getItem("meraj-cart") || "{}");
  if (savedCart && typeof savedCart === "object" && !Array.isArray(savedCart)) {
    cart = savedCart;
  }
} catch {
  cart = {};
}

const $ = id => document.getElementById(id);

const money = n => new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
}).format(n);

function safeText(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function showToast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function supabaseHeaders() {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
    throw new Error("Supabase URL or public key is missing from config.js.");
  }

  return {
    apikey: CONFIG.supabaseAnonKey,
    Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
    "Content-Type": "application/json"
  };
}

async function supabaseGet(path) {
  const response = await fetch(
    `${CONFIG.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${path}`,
    { headers: supabaseHeaders() }
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase returned ${response.status}: ${details}`);
  }

  return response.json();
}

async function loadCategories() {
  return supabaseGet(
    "categories?select=id,name,sort_order,visible&visible=eq.true&order=sort_order.asc,name.asc"
  );
}

async function loadProducts() {
  const rows = await supabaseGet(
    "products?select=id,category_id,name,description,price_paise,image_url,available,visible,featured,badge,sort_order,categories(name)&visible=eq.true&available=eq.true&order=sort_order.asc,name.asc"
  );

  return rows.map(row => ({
    id: row.id,
    category: row.categories?.name || "Other",
    name: row.name || "Unnamed product",
    description: row.description || "",
    price: Number(row.price_paise || 0) / 100,
    image: row.image_url || "",
    available: row.available !== false,
    featured: row.featured === true,
    badge: row.badge || ""
  }));
}

function saveCart() {
  localStorage.setItem("meraj-cart", JSON.stringify(cart));
  renderCart();
}

function getProduct(id) {
  return products.find(product => String(product.id) === String(id));
}

function cartQty() {
  return Object.values(cart).reduce((sum, item) => sum + Number(item.qty || 0), 0);
}

function subtotal() {
  return Object.values(cart).reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0),
    0
  );
}

function addToCart(id) {
  const product = getProduct(id);

  if (!product || !product.available) {
    showToast("This item is currently unavailable.");
    return;
  }

  const key = String(product.id);

  if (cart[key]) {
    cart[key].qty++;
  } else {
    cart[key] = {
      id: product.id,
      name: product.name,
      price: product.price,
      qty: 1,
      category: product.category
    };
  }

  saveCart();
  showToast(`${product.name} added to your bag`);
}

function setQty(id, delta) {
  const key = String(id);
  if (!cart[key]) return;

  cart[key].qty += delta;

  if (cart[key].qty <= 0) delete cart[key];

  saveCart();
}

function removeItem(id) {
  delete cart[String(id)];
  saveCart();
}

function imageMarkup(product) {
  const initials = safeText(
    product.name.split(" ").map(word => word[0]).join("").slice(0, 2)
  );

  if (!product.image) {
    return `<span class="placeholder-art" aria-hidden="true">${initials}</span>`;
  }

  return `<img src="${safeText(product.image)}" alt="${safeText(product.name)}" loading="lazy" onerror="this.outerHTML='<span class=&quot;placeholder-art&quot; aria-hidden=&quot;true&quot;>${initials}</span>'">`;
}

function cardMarkup(product) {
  const badge = product.badge
    ? `<span class="category-badge">${safeText(product.badge)}</span>`
    : product.featured
      ? '<span class="category-badge">FEATURED PICK</span>'
      : "";

  return `
    <article class="product-card">
      <div class="product-image">
        ${imageMarkup(product)}
        ${badge}
      </div>
      <div class="product-info">
        <h4>${safeText(product.name)}</h4>
        <p>${safeText(product.description)}</p>
        <div class="product-bottom">
          <span class="price">${money(product.price)}</span>
          <button class="add-button" data-add="${safeText(product.id)}" aria-label="Add ${safeText(product.name)} to cart">+ Add</button>
        </div>
      </div>
    </article>
  `;
}

function renderChips() {
  const el = $("categoryChips");
  if (!el) return;

  el.innerHTML = CATEGORIES.map(category => `
    <button class="category-chip ${activeCategory === category ? "active" : ""}" data-category="${safeText(category)}">${safeText(category)}</button>
  `).join("");
}

function renderMenu() {
  const query = $("searchInput").value.trim().toLowerCase();

  const filtered = products.filter(product =>
    (activeCategory === "All" || product.category === activeCategory) &&
    (!query || `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(query))
  );

  $("resultsCount").textContent =
    `Showing ${filtered.length} item${filtered.length === 1 ? "" : "s"}`;

  const target = $("menuContent");

  if (!filtered.length) {
    target.innerHTML = `
      <div class="no-results">
        <strong>No matching items found.</strong>
        <p>Try another search or choose a different category.</p>
      </div>
    `;
    return;
  }

  const categories = activeCategory === "All" && !query
    ? CATEGORIES.slice(1)
    : [...new Set(filtered.map(product => product.category))];

  target.innerHTML = categories.map(category => {
    const items = filtered.filter(product => product.category === category);
    if (!items.length) return "";

    return `
      <section class="menu-category" id="cat-${slug(category)}">
        <div class="category-title">
          <h3>${safeText(category)}</h3>
          <p>${items.length} item${items.length === 1 ? "" : "s"}</p>
        </div>
        <div class="product-grid">${items.map(cardMarkup).join("")}</div>
      </section>
    `;
  }).join("");
}

function renderFavorites() {
  const names = [
    "Strawberry Cake",
    "Chicken Zinger Burger",
    "Chicken 65 Roll",
    "Chicken Pizza (Regular)",
    "Lotus Cheese Pastry",
    "Double Ka Meetha Ki Roti",
    "Broasted Chicken — 2 Pc",
    "Apricot Delight Box"
  ];

  const items = names
    .map(name => products.find(product => product.name === name))
    .filter(Boolean);

  $("favoritesGrid").innerHTML = items.map(product => `
    <article class="favorite-card">
      <span class="favorite-category">${safeText(product.category)}</span>
      <h3>${safeText(product.name)}</h3>
      <div class="favorite-bottom">
        <strong>${money(product.price)}</strong>
        <button data-add="${safeText(product.id)}" aria-label="Add ${safeText(product.name)} to bag">+</button>
      </div>
    </article>
  `).join("");
}

function renderCart() {
  const count = cartQty();

  if ($("cartCount")) $("cartCount").textContent = count;
  if ($("bottomCartCount")) $("bottomCartCount").textContent = count;
  if ($("drawerCount")) $("drawerCount").textContent = `(${count})`;

  const entries = Object.values(cart);

  $("cartItems").innerHTML = entries.length
    ? entries.map(item => `
      <div class="cart-item">
        <div>
          <h4>${safeText(item.name)}</h4>
          <p>${money(item.price)} each</p>
          <div class="cart-item-actions">
            <button class="qty-button" data-qty="${safeText(item.id)}" data-delta="-1" aria-label="Decrease ${safeText(item.name)}">−</button>
            <span>${item.qty}</span>
            <button class="qty-button" data-qty="${safeText(item.id)}" data-delta="1" aria-label="Increase ${safeText(item.name)}">+</button>
            <button class="remove-item" data-remove="${safeText(item.id)}">Remove</button>
          </div>
        </div>
        <strong class="cart-item-total">${money(item.price * item.qty)}</strong>
      </div>
    `).join("")
    : `
      <div class="empty-cart">
        <div style="font-size:35px">♧</div>
        <strong>Your bag is waiting.</strong>
        <p>Add something delicious from the menu.</p>
        <button class="button button-outline" id="emptyBrowse">Browse menu</button>
      </div>
    `;

  $("cartSubtotal").textContent = money(subtotal());
  $("deliveryFee").textContent = Number.isFinite(CONFIG.deliveryFee)
    ? money(CONFIG.deliveryFee)
    : "To be confirmed";

  $("grandTotal").textContent = Number.isFinite(CONFIG.deliveryFee)
    ? money(subtotal() + CONFIG.deliveryFee)
    : `${money(subtotal())} + delivery`;

  if ($("emptyBrowse")) $("emptyBrowse").onclick = closeCart;
}

function openCart() {
  $("cartOverlay").hidden = false;
  $("cartDrawer").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeCart() {
  $("cartOverlay").hidden = true;
  $("cartDrawer").hidden = true;
  document.body.style.overflow = "";
}

function openCheckout() {
  if (!cartQty()) {
    showToast("Add an item before continuing.");
    return;
  }

  $("checkoutBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
  closeCart();
}

function closeCheckout() {
  $("checkoutBackdrop").hidden = true;
  document.body.style.overflow = "";
}

function buildOrderMessage(details = {}) {
  const lines = Object.values(cart).map(item =>
    `• ${item.name} × ${item.qty} — ${money(item.price * item.qty)} (₹${item.price} each)`
  );

  const fee = details.fulfilment === "Pickup" ? 0 : CONFIG.deliveryFee;
  const total = subtotal() + (Number.isFinite(fee) ? fee : 0);

  return [
    "Hello Meraj Sweets & Bakery, I'd like to enquire about this order.",
    "",
    `Customer: ${details.name || "(not provided)"}`,
    `Phone: ${details.phone || "(not provided)"}`,
    "",
    ...lines,
    "",
    `Subtotal: ${money(subtotal())}`,
    `Delivery fee: ${Number.isFinite(fee) ? money(fee) : "To be confirmed"}`,
    `Estimated total: ${Number.isFinite(fee) ? money(total) : money(subtotal()) + " + delivery fee to be confirmed"}`,
    `Fulfilment: ${details.fulfilment || "To be confirmed"}`,
    details.fulfilment === "Delivery" ? `Address: ${details.address || "(not provided)"}` : "",
    details.landmark ? `Landmark: ${details.landmark}` : "",
    details.instructions ? `Instructions: ${details.instructions}` : "",
    "",
    "Please confirm availability, delivery fee and final total.",
    "Opening WhatsApp does not confirm order acceptance."
  ].filter(Boolean).join("\n");
}

function openWhatsApp(details = {}) {
  if (!cartQty()) {
    showToast("Add an item before ordering.");
    return;
  }

  if (!CONFIG.whatsappNumber) {
    showToast("Business WhatsApp number needs to be configured first.");
    return;
  }

  const number = String(CONFIG.whatsappNumber).replace(/\D/g, "");
  const url = `https://wa.me/${number}?text=${encodeURIComponent(buildOrderMessage(details))}`;

  window.open(url, "_blank", "noopener,noreferrer");
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function updateAddressRequirement() {
  $("deliveryAddress").required = $("fulfilment").value === "Delivery";
  $("deliveryAddress").disabled = $("fulfilment").value === "Pickup";
}

function handleCheckoutSubmit(event) {
  event.preventDefault();

  const details = formData(event.currentTarget);

  if (details.fulfilment === "Delivery" && !details.address.trim()) {
    $("deliveryAddress").focus();
    return;
  }

  $("checkoutResult").hidden = false;
  $("checkoutResult").textContent =
    "Order summary prepared — no order has been saved yet.\n\n" +
    buildOrderMessage(details) +
    "\n\nUse “Prepare WhatsApp order” after configuring the business WhatsApp number to send this enquiry. A real persistent checkout requires a configured backend.";

  showToast("Summary prepared. Order not submitted.");
}

async function handleCakeSubmit(e) {
  e.preventDefault();

  const form = e.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const note = $("cakeFormNote");

  const config = window.MERAJ_CONFIG || {};
  const supabaseUrl = config.supabaseUrl;
  const supabaseKey = config.supabaseAnonKey;

  if (!supabaseUrl || !supabaseKey || !window.supabase?.createClient) {
    note.textContent =
      "Supabase configuration or library is missing. Check config.js and the Supabase script.";
    return;
  }

  const data = formData(form);
  const preferredDate = data.date || null;

  if (preferredDate) {
    const selectedDate = new Date(`${preferredDate}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (Number.isNaN(selectedDate.getTime()) || selectedDate < today) {
      note.textContent = "Please choose today or a future date.";
      return;
    }
  }

  const originalText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "Submitting request...";
  note.textContent = "Sending your cake request...";

  try {
    const client = window.supabase.createClient(
      supabaseUrl,
      supabaseKey
    );

    const { error } = await client
      .from("custom_cake_requests")
      .insert({
        customer_name: data.name.trim(),
        customer_phone: data.phone.trim(),
        cake_type: data.cakeType,
        size: data.size.trim() || null,
        flavour: data.flavour.trim() || null,
        message_on_cake: data.message.trim() || null,
        preferred_date: preferredDate,
        requirements: data.requirements.trim() || null,
        status: "New"
      });

    if (error) throw error;

    note.textContent =
      "Your cake request has been submitted successfully! The bakery team will review it and contact you to confirm availability and pricing.";

    form.reset();
    showToast("Cake request submitted successfully.");
  } catch (error) {
    console.error("Cake request submission failed:", error);
    note.textContent = `Submission failed: ${error.message || "Check your Supabase table and permissions."}`;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalText;
  }
}

document.addEventListener("click", event => {
  const add = event.target.closest("[data-add]");
  if (add) addToCart(add.dataset.add);

  const quantity = event.target.closest("[data-qty]");
  if (quantity) setQty(quantity.dataset.qty, Number(quantity.dataset.delta));

  const remove = event.target.closest("[data-remove]");
  if (remove) removeItem(remove.dataset.remove);

  const chip = event.target.closest("[data-category]");

  if (chip) {
    activeCategory = chip.dataset.category;
    renderChips();
    renderMenu();

    if (activeCategory !== "All") {
      $("menu").scrollIntoView({ behavior: "smooth" });
    }
  }

  if (event.target.closest("#mobileNav a")) {
    $("mobileNav").classList.remove("open");
  }
});

$("searchInput").addEventListener("input", renderMenu);

$("clearSearch").addEventListener("click", () => {
  $("searchInput").value = "";
  renderMenu();
});

$("openCart").addEventListener("click", openCart);
$("bottomCart").addEventListener("click", openCart);
$("closeCart").addEventListener("click", closeCart);
$("cartOverlay").addEventListener("click", closeCart);
$("checkoutButton").addEventListener("click", openCheckout);
$("closeCheckout").addEventListener("click", closeCheckout);

$("checkoutBackdrop").addEventListener("click", event => {
  if (event.target === $("checkoutBackdrop")) closeCheckout();
});

$("checkoutForm").addEventListener("submit", handleCheckoutSubmit);
$("fulfilment").addEventListener("change", updateAddressRequirement);
$("whatsappButton").addEventListener("click", () => openWhatsApp());
$("cakeForm").addEventListener("submit", handleCakeSubmit);

$("mobileMenuToggle").addEventListener("click", () =>
  $("mobileNav").classList.toggle("open")
);

$("searchToggle").addEventListener("click", () => {
  $("searchPanel").scrollIntoView({ behavior: "smooth" });
  $("searchInput").focus();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeCart();
    closeCheckout();
    $("mobileNav").classList.remove("open");
  }
});

async function init() {
  $("year").textContent = new Date().getFullYear();
  $("hoursText").textContent =
    CONFIG.openingHours || "Opening hours need confirmation.";

  updateAddressRequirement();
  renderCart();

  $("menuContent").innerHTML =
    '<div class="no-results">Loading the latest menu...</div>';

  try {
    const [categories, loadedProducts] = await Promise.all([
      loadCategories(),
      loadProducts()
    ]);

    products = loadedProducts;

    CATEGORIES = [
      "All",
      ...categories
        .map(category => category.name)
        .filter(name => name && name !== "All")
    ];

    const refreshedCart = {};

    for (const item of Object.values(cart)) {
      const current = getProduct(item.id);
      if (!current) continue;

      const key = String(current.id);
      const previousQty = Number(item.qty) || 0;

      if (previousQty <= 0) continue;

      if (refreshedCart[key]) {
        refreshedCart[key].qty += previousQty;
      } else {
        refreshedCart[key] = {
          id: current.id,
          name: current.name,
          price: current.price,
          qty: previousQty,
          category: current.category
        };
      }
    }

    cart = refreshedCart;
    saveCart();
    renderChips();
    renderMenu();
    renderFavorites();

    if (!products.length) {
      $("menuContent").innerHTML = `
        <div class="no-results">
          <strong>Your menu is currently empty.</strong>
          <p>Import your products into Supabase or add them through the admin panel.</p>
        </div>
      `;
    }
  } catch (error) {
    console.error("Could not load the Supabase menu:", error);

    $("resultsCount").textContent = "Menu unavailable";
    $("menuContent").innerHTML = `
      <div class="no-results">
        <strong>We couldn't load the menu.</strong>
        <p>Check your Supabase configuration, database tables, product data and Row Level Security policies, then refresh this page.</p>
        <p>Details: ${safeText(error.message)}</p>
      </div>
    `;

    renderChips();
    renderFavorites();
  }
}

init();
