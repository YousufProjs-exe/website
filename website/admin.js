
"use strict";

const CONFIG = window.MERAJ_CONFIG || {};
const SUPABASE_URL = CONFIG.supabaseUrl || "";
const SUPABASE_ANON_KEY = CONFIG.supabaseAnonKey || "";
const STORAGE_BUCKET = CONFIG.storageBucket || "product-images";

const TABLE_PRODUCTS = "products";
const TABLE_CATEGORIES = "categories";
const TABLE_ADMIN_PROFILES = "admin_profiles";

const authView = document.getElementById("authView");
const adminView = document.getElementById("adminView");
const loginForm = document.getElementById("loginForm");
const loginButton = document.getElementById("loginButton");
const authMessage = document.getElementById("authMessage");
const logoutButton = document.getElementById("logoutButton");
const adminEmail = document.getElementById("adminEmail");

const statProducts = document.getElementById("statProducts");
const statAvailable = document.getElementById("statAvailable");
const statFeatured = document.getElementById("statFeatured");

const addProductButton = document.getElementById("addProductButton");
const addProductShortcut = document.getElementById("addProductShortcut");
const productSearch = document.getElementById("productSearch");
const productFilter = document.getElementById("productFilter");
const productsTable = document.getElementById("productsTable");

const productDialog = document.getElementById("productDialog");
const productForm = document.getElementById("productForm");
const productId = document.getElementById("productId");
const productName = document.getElementById("productName");
const productCategory = document.getElementById("productCategory");
const productPrice = document.getElementById("productPrice");
const productDescription = document.getElementById("productDescription");
const productImage = document.getElementById("productImage");
const imageStatus = document.getElementById("imageStatus");
const productAvailable = document.getElementById("productAvailable");
const productVisible = document.getElementById("productVisible");
const productFeatured = document.getElementById("productFeatured");
const formMessage = document.getElementById("formMessage");
const saveProductButton = document.getElementById("saveProductButton");

let supabaseClient = null;
let currentUser = null;
let currentAdminProfile = null;
let products = [];
let categories = [];
let isSavingProduct = false;
let currentImageUrl = "";
let currentImageFile = null;

function setMessage(element, message, type = "") {
  if (!element) return;

  element.textContent = message;
  element.classList.remove("success", "error");

  if (type) element.classList.add(type);
}

function setButtonLoading(button, loading, loadingText = "Please wait...") {
  if (!button) return;

  if (loading) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }

    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    delete button.dataset.originalText;
    button.disabled = false;
  }
}

function getErrorMessage(error) {
  return error?.message || "Something went wrong. Please try again.";
}

function formatRupees(paise) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(paise || 0) / 100);
}

function escapeHTML(value) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  return String(value ?? "").replace(/[&<>"']/g, character => replacements[character]);
}

function showAuth() {
  if (authView) authView.hidden = false;
  if (adminView) adminView.hidden = true;
}

function showDashboard() {
  if (authView) authView.hidden = true;
  if (adminView) adminView.hidden = false;
}

function isFileInput(element) {
  return element instanceof HTMLInputElement && element.type === "file";
}

function getProductImageValue() {
  if (!productImage || isFileInput(productImage)) return "";
  return productImage.value.trim();
}

function setImageInputValue(value) {
  if (!productImage) return;

  if (isFileInput(productImage)) {
    productImage.value = "";
  } else {
    productImage.value = value || "";
  }
}

function getSelectedImageFile() {
  if (!productImage) return null;

  if (isFileInput(productImage)) {
    return productImage.files?.[0] || null;
  }

  return currentImageFile;
}

function isValidImageUrl(value) {
  if (!value) return true;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function initializeAdmin() {
  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    !window.supabase ||
    typeof window.supabase.createClient !== "function"
  ) {
    showAuth();
    setMessage(
      authMessage,
      "Supabase configuration is missing. Check config.js and the Supabase library script.",
      "error"
    );

    if (loginButton) loginButton.disabled = true;
    return;
  }

  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  try {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) throw error;

    if (data.session?.user) {
      await verifyAdmin(data.session.user);
    } else {
      showAuth();
    }
  } catch (error) {
    showAuth();
    setMessage(authMessage, getErrorMessage(error), "error");
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session?.user) {
      currentUser = null;
      currentAdminProfile = null;
      products = [];
      categories = [];
      showAuth();
      return;
    }

    if (event === "SIGNED_IN" && !currentAdminProfile) {
      setTimeout(() => {
        verifyAdmin(session.user).catch(error => {
          showAuth();
          setMessage(authMessage, getErrorMessage(error), "error");
        });
      }, 0);
    }
  });
}

async function handleLogin(event) {
  event.preventDefault();

  if (!supabaseClient) {
    setMessage(authMessage, "Supabase is not configured.", "error");
    return;
  }

  const email = document.getElementById("loginEmail")?.value.trim() || "";
  const password = document.getElementById("loginPassword")?.value || "";

  if (!email || !password) {
    setMessage(authMessage, "Enter your email and password.", "error");
    return;
  }

  setMessage(authMessage, "");
  setButtonLoading(loginButton, true, "Signing in...");

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    await verifyAdmin(data.user);
  } catch (error) {
    setMessage(authMessage, getErrorMessage(error), "error");
    await supabaseClient.auth.signOut().catch(() => {});
  } finally {
    setButtonLoading(loginButton, false);
  }
}

async function verifyAdmin(user) {
  if (!supabaseClient || !user) {
    showAuth();
    return;
  }

  try {
    const { data: profile, error } = await supabaseClient
      .from(TABLE_ADMIN_PROFILES)
      .select("user_id, display_name, role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (!profile || !["owner", "staff"].includes(profile.role)) {
      currentUser = null;
      currentAdminProfile = null;

      await supabaseClient.auth.signOut();

      showAuth();
      setMessage(
        authMessage,
        "This account does not have admin access. Add its user ID to admin_profiles.",
        "error"
      );

      return;
    }

    currentUser = user;
    currentAdminProfile = profile;

    showDashboard();

    if (adminEmail) {
      adminEmail.textContent = profile.display_name || user.email || "Admin";
    }

    await loadDashboardData();
  } catch (error) {
    showAuth();
    setMessage(
      authMessage,
      "Could not verify admin access: " + getErrorMessage(error),
      "error"
    );
  }
}

async function handleLogout() {
  if (!supabaseClient) return;

  if (logoutButton) logoutButton.disabled = true;

  try {
    const { error } = await supabaseClient.auth.signOut();

    if (error) throw error;

    currentUser = null;
    currentAdminProfile = null;
    products = [];
    categories = [];

    showAuth();
  } catch (error) {
    alert("Could not sign out: " + getErrorMessage(error));
  } finally {
    if (logoutButton) logoutButton.disabled = false;
  }
}

function activatePanel(panelName) {
  document.querySelectorAll("[data-panel]").forEach(button => {
    const active = button.dataset.panel === panelName;

    button.classList.toggle("active", active);

    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  document.querySelectorAll(".admin-panel").forEach(panel => {
    const active =
      panel.id === panelName ||
      panel.id === `${panelName}Panel` ||
      panel.id === `panel-${panelName}`;

    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });

  if (panelName === "products") renderProducts();
}

function setupNavigation() {
  document.querySelectorAll("[data-panel]").forEach(button => {
    button.addEventListener("click", () => {
      activatePanel(button.dataset.panel);
    });
  });
}

async function loadDashboardData() {
  await Promise.all([loadCategories(), loadProducts()]);
  updateStats();
  renderProducts();
}

async function loadCategories() {
  const { data, error } = await supabaseClient
    .from(TABLE_CATEGORIES)
    .select("id, name, sort_order, visible")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("Category loading failed:", error);
    categories = [];
    populateCategoryOptions();

    setMessage(
      formMessage,
      "Could not load categories: " + getErrorMessage(error),
      "error"
    );

    return;
  }

  categories = data || [];
  populateCategoryOptions();
}

async function loadProducts() {
  if (!productsTable) return;

  productsTable.innerHTML =
    '<tr><td colspan="7" class="table-empty">Loading products...</td></tr>';

  const { data, error } = await supabaseClient
    .from(TABLE_PRODUCTS)
    .select(`
      id,
      category_id,
      name,
      description,
      price_paise,
      image_url,
      available,
      visible,
      featured,
      badge,
      sort_order,
      created_at,
      updated_at
    `)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    products = [];
    productsTable.innerHTML =
      '<tr><td colspan="7" class="table-empty">Could not load products. Check the console.</td></tr>';

    console.error("Product loading failed:", error);
    return;
  }

  products = data || [];
}

function populateCategoryOptions(selectedId = "") {
  if (!productCategory) return;

  const currentValue = selectedId || productCategory.value;

  productCategory.innerHTML =
    '<option value="">Select a category</option>';

  categories.forEach(category => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    option.disabled = category.visible === false;
    productCategory.appendChild(option);
  });

  if (categories.some(category => category.id === currentValue)) {
    productCategory.value = currentValue;
  }
}

function updateStats() {
  if (statProducts) statProducts.textContent = String(products.length);

  if (statAvailable) {
    statAvailable.textContent = String(
      products.filter(product => product.available).length
    );
  }

  if (statFeatured) {
    statFeatured.textContent = String(
      products.filter(product => product.featured).length
    );
  }
}

function getCategoryName(categoryId) {
  return categories.find(category => category.id === categoryId)?.name ||
    "Uncategorized";
}

function getFilteredProducts() {
  const searchTerm = (productSearch?.value || "").trim().toLowerCase();
  const filter = productFilter?.value || "all";

  return products.filter(product => {
    const matchesSearch =
      !searchTerm ||
      String(product.name || "").toLowerCase().includes(searchTerm) ||
      String(product.description || "").toLowerCase().includes(searchTerm) ||
      getCategoryName(product.category_id).toLowerCase().includes(searchTerm);

    let matchesFilter = true;

    if (filter === "available") matchesFilter = product.available === true;
    if (filter === "unavailable") matchesFilter = product.available === false;
    if (filter === "visible") matchesFilter = product.visible === true;
    if (filter === "hidden") matchesFilter = product.visible === false;
    if (filter === "featured") matchesFilter = product.featured === true;

    return matchesSearch && matchesFilter;
  });
}

function renderProducts() {
  if (!productsTable) return;

  const filteredProducts = getFilteredProducts();

  if (!filteredProducts.length) {
    productsTable.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty">
          No products found. Add a product or change your search.
        </td>
      </tr>
    `;
    return;
  }

  productsTable.innerHTML = filteredProducts.map(product => {
    const safeName = escapeHTML(product.name);
    const safeCategory = escapeHTML(getCategoryName(product.category_id));

    const imageMarkup = product.image_url
      ? `<img src="${escapeHTML(product.image_url)}" alt="${safeName}" loading="lazy" referrerpolicy="no-referrer">`
      : "🍰";

    const availabilityMarkup = product.available
      ? '<span class="status-badge available">Available</span>'
      : '<span class="status-badge unavailable">Unavailable</span>';

    const visibilityMarkup = product.visible
      ? '<span class="status-badge success">Visible</span>'
      : '<span class="status-badge neutral">Hidden</span>';

    const featuredMarkup = product.featured
      ? '<span class="status-badge pending">Featured</span>'
      : "—";

    return `
      <tr>
        <td>
          <div class="product-cell">
            <div class="product-thumbnail">${imageMarkup}</div>
            <div>
              <strong>${safeName}</strong>
              <small>${safeCategory}</small>
            </div>
          </div>
        </td>
        <td>${formatRupees(product.price_paise)}</td>
        <td>${availabilityMarkup}</td>
        <td>${visibilityMarkup}</td>
        <td>${featuredMarkup}</td>
        <td>${safeCategory}</td>
        <td>
          <div class="table-actions">
            <button type="button" data-edit-product="${escapeHTML(product.id)}">Edit</button>
            <button type="button" data-delete-product="${escapeHTML(product.id)}" class="text-danger">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function openProductDialog(product = null) {
  if (!productDialog || !productForm) return;

  productForm.reset();
  setMessage(formMessage, "");

  currentImageFile = null;
  currentImageUrl = product?.image_url || "";

  if (productId) productId.value = product?.id || "";
  if (productName) productName.value = product?.name || "";

  if (productPrice) {
    productPrice.value = product
      ? (Number(product.price_paise || 0) / 100).toFixed(2)
      : "";
  }

  if (productDescription) {
    productDescription.value = product?.description || "";
  }

  if (productAvailable) {
    productAvailable.checked = product ? product.available === true : true;
  }

  if (productVisible) {
    productVisible.checked = product ? product.visible === true : true;
  }

  if (productFeatured) {
    productFeatured.checked = product?.featured === true;
  }

  setImageInputValue(product?.image_url || "");
  populateCategoryOptions(product?.category_id || "");

  if (imageStatus) {
    imageStatus.textContent = product?.image_url
      ? "Current image saved. Choose a new image to replace it."
      : "No image selected.";
  }

  const title = productDialog.querySelector(".dialog-header h2");
  if (title) title.textContent = product ? "Edit product" : "Add product";

  if (typeof productDialog.showModal === "function") {
    productDialog.showModal();
  } else {
    productDialog.setAttribute("open", "");
  }
}

function closeProductDialog() {
  if (!productDialog) return;

  if (typeof productDialog.close === "function") {
    productDialog.close();
  } else {
    productDialog.removeAttribute("open");
  }
}

function handleImageChange() {
  if (!productImage) return;

  if (isFileInput(productImage)) {
    currentImageFile = productImage.files?.[0] || null;

    if (!currentImageFile) {
      if (imageStatus) {
        imageStatus.textContent = currentImageUrl
          ? "Current image saved."
          : "No image selected.";
      }
      return;
    }

    if (!currentImageFile.type.startsWith("image/")) {
      currentImageFile = null;
      productImage.value = "";
      setMessage(formMessage, "Please select an image file.", "error");
      return;
    }

    if (currentImageFile.size > 5 * 1024 * 1024) {
      currentImageFile = null;
      productImage.value = "";
      setMessage(formMessage, "Image must be 5 MB or smaller.", "error");
      return;
    }

    if (imageStatus) {
      imageStatus.textContent = "Selected: " + currentImageFile.name;
    }

    return;
  }

  const url = productImage.value.trim();

  if (url && !isValidImageUrl(url)) {
    setMessage(formMessage, "Enter a valid HTTP or HTTPS image URL.", "error");
    return;
  }

  currentImageUrl = url;

  if (imageStatus) {
    imageStatus.textContent = url ? "Image URL entered." : "No image selected.";
  }
}

async function uploadProductImage(file) {
  if (!file) return currentImageUrl || getProductImageValue();

  if (!file.type.startsWith("image/")) {
    throw new Error("The selected file is not an image.");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Image must be 5 MB or smaller.");
  }

  const extension = file.name.includes(".")
    ? file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "")
    : "jpg";

  const filePath = `${currentUser.id}/${crypto.randomUUID()}.${extension || "jpg"}`;

  const { error } = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });

  if (error) {
    throw new Error(
      "Image upload failed. Check the storage bucket and upload policies. " +
      error.message
    );
  }

  const { data } = supabaseClient.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filePath);

  if (!data?.publicUrl) {
    throw new Error("Could not get the uploaded image URL.");
  }

  return data.publicUrl;
}

async function handleProductSave(event) {
  event.preventDefault();

  if (!supabaseClient || !currentUser || !currentAdminProfile) {
    setMessage(formMessage, "Sign in with an authorized admin account.", "error");
    return;
  }

  if (isSavingProduct) return;

  const name = productName?.value.trim() || "";
  const categoryId = productCategory?.value || "";
  const description = productDescription?.value.trim() || "";
  const rupeeValue = Number(productPrice?.value);
  const imageFile = getSelectedImageFile();
  const imageUrl = getProductImageValue();

  if (!name) {
    setMessage(formMessage, "Enter a product name.", "error");
    productName?.focus();
    return;
  }

  if (!categoryId) {
    setMessage(formMessage, "Select a category.", "error");
    productCategory?.focus();
    return;
  }

  if (!Number.isFinite(rupeeValue) || rupeeValue < 0 || rupeeValue > 10000000) {
    setMessage(formMessage, "Enter a valid price in rupees.", "error");
    productPrice?.focus();
    return;
  }

  if (!isFileInput(productImage) && imageUrl && !isValidImageUrl(imageUrl)) {
    setMessage(formMessage, "Enter a valid HTTP or HTTPS image URL.", "error");
    return;
  }

  isSavingProduct = true;
  setButtonLoading(saveProductButton, true, "Saving...");
  setMessage(formMessage, "");

  try {
    const uploadedImageUrl = imageFile
      ? await uploadProductImage(imageFile)
      : imageUrl || currentImageUrl || null;

    const existingId = productId?.value.trim() || "";

    const payload = {
      category_id: categoryId,
      name,
      description: description || null,
      price_paise: Math.round(rupeeValue * 100),
      image_url: uploadedImageUrl,
      available: productAvailable?.checked ?? true,
      visible: productVisible?.checked ?? true,
      featured: productFeatured?.checked ?? false,
      updated_at: new Date().toISOString()
    };

    let result;

    if (existingId) {
      result = await supabaseClient
        .from(TABLE_PRODUCTS)
        .update(payload)
        .eq("id", existingId)
        .select("id")
        .single();
    } else {
      result = await supabaseClient
        .from(TABLE_PRODUCTS)
        .insert(payload)
        .select("id")
        .single();
    }

    if (result.error) throw result.error;

    closeProductDialog();
    await loadProducts();
    updateStats();
    renderProducts();

    setMessage(
      authMessage,
      existingId ? "Product updated successfully." : "Product added successfully.",
      "success"
    );
  } catch (error) {
    setMessage(formMessage, getErrorMessage(error), "error");
  } finally {
    isSavingProduct = false;
    setButtonLoading(saveProductButton, false);
  }
}

function handleProductTableClick(event) {
  const button = event.target.closest("button");
  if (!button) return;

  const editId = button.dataset.editProduct;
  const deleteId = button.dataset.deleteProduct;

  if (editId) {
    const product = products.find(item => item.id === editId);
    if (product) openProductDialog(product);
  }

  if (deleteId) deleteProduct(deleteId);
}

async function deleteProduct(id) {
  if (!currentUser || !currentAdminProfile) {
    alert("You must be signed in as an admin.");
    return;
  }

  const product = products.find(item => item.id === id);
  if (!product) return;

  if (!window.confirm(`Delete "${product.name}" permanently? This cannot be undone.`)) {
    return;
  }

  try {
    const { error } = await supabaseClient
      .from(TABLE_PRODUCTS)
      .delete()
      .eq("id", id);

    if (error) throw error;

    products = products.filter(item => item.id !== id);
    updateStats();
    renderProducts();
  } catch (error) {
    alert("Could not delete product: " + getErrorMessage(error));
  }
}

function setupEventListeners() {
  loginForm?.addEventListener("submit", handleLogin);
  logoutButton?.addEventListener("click", handleLogout);

  addProductButton?.addEventListener("click", () => {
    openProductDialog();
  });

  addProductShortcut?.addEventListener("click", () => {
    activatePanel("products");
    openProductDialog();
  });

  productForm?.addEventListener("submit", handleProductSave);
  productSearch?.addEventListener("input", renderProducts);
  productFilter?.addEventListener("change", renderProducts);
  productsTable?.addEventListener("click", handleProductTableClick);
  productImage?.addEventListener("change", handleImageChange);

  document.querySelectorAll("[data-close-dialog]").forEach(button => {
    button.addEventListener("click", closeProductDialog);
  });

  productDialog?.addEventListener("click", event => {
    if (event.target === productDialog) closeProductDialog();
  });

  productDialog?.addEventListener("close", () => {
    setMessage(formMessage, "");
  });

  setupNavigation();
}

setupEventListeners();
initializeAdmin();
