
"use strict";

const CONFIG = window.MERAJ_CONFIG || {};
const SUPABASE_URL = CONFIG.supabaseUrl || "";
const SUPABASE_ANON_KEY = CONFIG.supabaseAnonKey || "";
const STORAGE_BUCKET = CONFIG.storageBucket || "product-images";

const TABLE_PRODUCTS = "products";
const TABLE_CATEGORIES = "categories";
const TABLE_ADMIN_PROFILES = "admin_profiles";
const TABLE_CAKE_REQUESTS = "custom_cake_requests";

const CAKE_STATUSES = [
  "New",
  "Reviewing",
  "Awaiting customer",
  "Confirmed",
  "Completed",
  "Cancelled"
];

const authView = document.getElementById("authView");
const adminView = document.getElementById("adminView");
const loginForm = document.getElementById("loginForm");
const loginButton = document.getElementById("loginButton");
const authMessage = document.getElementById("authMessage");
const logoutButton = document.getElementById("logoutButton");
const adminEmail = document.getElementById("adminEmail");
const globalMessage = document.getElementById("globalMessage");

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

const cakeOrdersTable = document.getElementById("cakeOrdersTable");
const refreshCakeOrdersButton = document.getElementById(
  "refreshCakeOrdersButton"
);

let supabaseClient = null;
let currentUser = null;
let currentAdminProfile = null;
let products = [];
let categories = [];
let cakeRequests = [];
let isSavingProduct = false;
let isSavingCakeRequest = false;
let isLoadingCakeRequests = false;
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

function escapeHTML(value) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  return String(value ?? "").replace(/[&<>"']/g, character => {
    return replacements[character];
  });
}

function formatRupees(paise) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(paise || 0) / 100);
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

function getProductById(id) {
  return products.find(product => String(product.id) === String(id)) || null;
}

function getCategoryById(id) {
  return categories.find(category => String(category.id) === String(id)) || null;
}

function getCategoryName(categoryId) {
  return getCategoryById(categoryId)?.name || "Uncategorized";
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
      cakeRequests = [];
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
    cakeRequests = [];

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

  document.querySelectorAll(".panel").forEach(panel => {
    panel.hidden = panel.id !== `${panelName}Panel`;
  });

  const pageTitle = document.getElementById("pageTitle");

  const titles = {
    overview: "Overview",
    products: "Products",
    orders: "Orders",
    "cake-orders": "Cake Orders",
    settings: "Store settings"
  };

  if (pageTitle) {
    pageTitle.textContent = titles[panelName] || "Overview";
  }

  if (panelName === "products") {
    renderProducts();
  }

  if (panelName === "cake-orders") {
    loadCakeRequests();
  }
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
  if (!supabaseClient) return;

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

  categories = Array.isArray(data) ? data : [];
  populateCategoryOptions();
}

async function loadProducts() {
  if (!productsTable || !supabaseClient) return;

  productsTable.innerHTML = `
    <tr>
      <td colspan="7" class="table-empty">Loading products...</td>
    </tr>
  `;

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

    productsTable.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty">
          Could not load products. Check the console.
        </td>
      </tr>
    `;

    console.error("Product loading failed:", error);
    return;
  }

  products = Array.isArray(data) ? data : [];
}

function populateCategoryOptions(selectedId = "") {
  if (!productCategory) return;

  const currentValue = String(selectedId || productCategory.value || "");

  productCategory.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = categories.length
    ? "Choose a category"
    : "No categories found";

  productCategory.appendChild(placeholder);

  categories.forEach(category => {
    const option = document.createElement("option");

    option.value = String(category.id);
    option.textContent = category.name;
    option.disabled = category.visible === false;

    productCategory.appendChild(option);
  });

  if (currentValue) {
    productCategory.value = currentValue;
  }
}

function updateStats() {
  if (statProducts) {
    statProducts.textContent = String(products.length);
  }

  if (statAvailable) {
    statAvailable.textContent = String(
      products.filter(product => product.available === true).length
    );
  }

  if (statFeatured) {
    statFeatured.textContent = String(
      products.filter(product => product.featured === true).length
    );
  }
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
    const safeId = escapeHTML(product.id);
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
            <button type="button" data-edit-product="${safeId}">Edit</button>
            <button type="button" data-delete-product="${safeId}" class="text-danger">Delete</button>
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

  if (productId) productId.value = product ? String(product.id) : "";
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

  if (title) {
    title.textContent = product ? "Edit product" : "Add product";
  }

  if (typeof productDialog.showModal === "function") {
    if (!productDialog.open) productDialog.showModal();
  } else {
    productDialog.setAttribute("open", "");
  }
}

function closeProductDialog() {
  if (!productDialog) return;

  if (typeof productDialog.close === "function") {
    if (productDialog.open) productDialog.close();
  } else {
    productDialog.removeAttribute("open");
  }
}

function handleImageChange() {
  if (!productImage) return;

  setMessage(formMessage, "");

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
    setMessage(
      formMessage,
      "Enter a valid HTTP or HTTPS image URL.",
      "error"
    );

    return;
  }

  currentImageUrl = url;

  if (imageStatus) {
    imageStatus.textContent = url ? "Image URL entered." : "No image selected.";
  }
}

async function uploadProductImage(file) {
  if (!file) {
    return currentImageUrl || getProductImageValue() || null;
  }

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
    setMessage(
      formMessage,
      "Sign in with an authorized admin account.",
      "error"
    );

    return;
  }

  if (isSavingProduct) return;

  const name = productName?.value.trim() || "";
  const categoryId = productCategory?.value || "";
  const description = productDescription?.value.trim() || "";
  const rupeeValue = Number(productPrice?.value);
  const imageFile = getSelectedImageFile();
  const imageUrl = getProductImageValue();
  const existingId = productId?.value.trim() || "";

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

  if (!getCategoryById(categoryId)) {
    setMessage(
      formMessage,
      "The selected category no longer exists. Reload categories and try again.",
      "error"
    );

    return;
  }

  if (
    !Number.isFinite(rupeeValue) ||
    rupeeValue < 0 ||
    rupeeValue > 10000000
  ) {
    setMessage(formMessage, "Enter a valid price in rupees.", "error");
    productPrice?.focus();
    return;
  }

  if (
    !isFileInput(productImage) &&
    imageUrl &&
    !isValidImageUrl(imageUrl)
  ) {
    setMessage(
      formMessage,
      "Enter a valid HTTP or HTTPS image URL.",
      "error"
    );

    return;
  }

  isSavingProduct = true;
  setButtonLoading(saveProductButton, true, "Saving...");
  setMessage(formMessage, "");

  try {
    const uploadedImageUrl = imageFile
      ? await uploadProductImage(imageFile)
      : imageUrl || currentImageUrl || null;

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
        .maybeSingle();
    } else {
      result = await supabaseClient
        .from(TABLE_PRODUCTS)
        .insert(payload)
        .select("id")
        .single();
    }

    if (result.error) throw result.error;

    if (existingId && !result.data) {
      throw new Error(
        "The product was not updated. It may have been deleted or you may not have permission to update it."
      );
    }

    closeProductDialog();

    await loadProducts();
    updateStats();
    renderProducts();

    setMessage(
      globalMessage || authMessage,
      existingId
        ? "Product updated successfully."
        : "Product added successfully.",
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

  if (!button || !productsTable?.contains(button)) return;

  const editId = button.dataset.editProduct;
  const deleteId = button.dataset.deleteProduct;

  if (editId !== undefined) {
    const product = getProductById(editId);

    if (product) {
      openProductDialog(product);
    } else {
      setMessage(
        globalMessage || authMessage,
        "That product could not be found. Refresh the product list.",
        "error"
      );
    }

    return;
  }

  if (deleteId !== undefined) {
    deleteProduct(deleteId, button);
  }
}

async function deleteProduct(id, button = null) {
  if (!supabaseClient || !currentUser || !currentAdminProfile) {
    alert("You must be signed in as an admin.");
    return;
  }

  const product = getProductById(id);

  if (!product) {
    setMessage(
      globalMessage || authMessage,
      "That product could not be found. Refresh the product list.",
      "error"
    );

    return;
  }

  const confirmed = window.confirm(
    `Delete "${product.name}" permanently? This cannot be undone.`
  );

  if (!confirmed) return;

  if (button) {
    button.disabled = true;
    button.textContent = "Deleting...";
  }

  try {
    const { data, error } = await supabaseClient
      .from(TABLE_PRODUCTS)
      .delete()
      .eq("id", id)
      .select("id");

    if (error) throw error;

    if (!data || data.length === 0) {
      throw new Error(
        "No product was deleted. Check your admin permissions and Supabase delete policies."
      );
    }

    products = products.filter(item => String(item.id) !== String(id));

    updateStats();
    renderProducts();

    setMessage(
      globalMessage || authMessage,
      "Product deleted successfully.",
      "success"
    );
  } catch (error) {
    alert("Could not delete product: " + getErrorMessage(error));

    if (button) {
      button.disabled = false;
      button.textContent = "Delete";
    }
  }
}

function formatCakeDate(value) {
  if (!value) return "Not specified";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatCakeTimestamp(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

async function loadCakeRequests() {
  if (!cakeOrdersTable || !supabaseClient || isLoadingCakeRequests) return;

  if (!currentUser || !currentAdminProfile) {
    setMessage(
      globalMessage || authMessage,
      "Sign in with an authorized admin account to view cake orders.",
      "error"
    );

    return;
  }

  isLoadingCakeRequests = true;
  setButtonLoading(refreshCakeOrdersButton, true, "Refreshing...");

  cakeOrdersTable.innerHTML = `
    <tr>
      <td colspan="6" class="table-empty">Loading cake requests...</td>
    </tr>
  `;

  try {
    const { data, error } = await supabaseClient
      .from(TABLE_CAKE_REQUESTS)
      .select(`
        id,
        customer_name,
        customer_phone,
        cake_type,
        size,
        flavour,
        message_on_cake,
        preferred_date,
        requirements,
        reference_image_url,
        status,
        staff_notes,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    cakeRequests = Array.isArray(data) ? data : [];
    renderCakeRequests();
  } catch (error) {
    console.error("Could not load cake requests:", error);

    cakeOrdersTable.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">
          Could not load cake requests: ${escapeHTML(getErrorMessage(error))}
        </td>
      </tr>
    `;
  } finally {
    isLoadingCakeRequests = false;
    setButtonLoading(refreshCakeOrdersButton, false);
  }
}

function renderCakeRequests() {
  if (!cakeOrdersTable) return;

  if (!cakeRequests.length) {
    cakeOrdersTable.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">
          No cake requests found yet.
        </td>
      </tr>
    `;

    return;
  }

  function cleanDetail(value, fallback = "Not provided") {
    if (value == null || value === "") return fallback;

    const source = String(value)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n");

    const parsed = new DOMParser().parseFromString(source, "text/html");

    return (parsed.body.textContent || "")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || fallback;
  }

  function detailBlock(label, value, fallback) {
    return `
      <div class="cake-detail">
        <span>${label}</span>
        <p>${escapeHTML(cleanDetail(value, fallback))}</p>
      </div>
    `;
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  cakeOrdersTable.innerHTML = cakeRequests.map(request => {
    const id = escapeHTML(request.id);
    const name = escapeHTML(
      cleanDetail(request.customer_name, "Unnamed customer")
    );
    const phone = escapeHTML(
      cleanDetail(request.customer_phone, "No phone provided")
    );

    const status = CAKE_STATUSES.includes(request.status)
      ? request.status
      : "New";

    const notes = escapeHTML(request.staff_notes || "");
    const referenceUrl = safeHttpUrl(request.reference_image_url);
    const statusClass = status.toLowerCase().replace(/[^a-z]+/g, "-");

    const statusOptions = CAKE_STATUSES.map(option => `
      <option value="${escapeHTML(option)}"
        ${option === status ? "selected" : ""}>
        ${escapeHTML(option)}
      </option>
    `).join("");

    const imageMarkup = referenceUrl
      ? `
        <a class="cake-reference-link"
           href="${escapeHTML(referenceUrl)}"
           target="_blank"
           rel="noopener noreferrer">
          <img src="${escapeHTML(referenceUrl)}"
               alt="Customer's cake reference"
               loading="lazy"
               referrerpolicy="no-referrer">
          <span>View reference image ↗</span>
        </a>
      `
      : `<p class="cake-muted">No reference image attached</p>`;

    const completed = status === "Completed";

    return `
      <tr class="cake-order-row" data-cake-request="${id}">
        <td colspan="6">
          <article class="cake-order-card">
            <header class="cake-order-header">
              <div class="cake-customer">
                <span class="cake-order-icon" aria-hidden="true">🎂</span>
                <div>
                  <p class="cake-eyebrow">CUSTOM CAKE REQUEST</p>
                  <h3>${name}</h3>
                  <a class="cake-phone"
                     href="tel:${escapeHTML(String(request.customer_phone || "").replace(/[^\d+]/g, ""))}">
                    ${phone}
                  </a>
                </div>
              </div>

              <span class="cake-status-badge cake-status-${statusClass}">
                ${escapeHTML(status)}
              </span>
            </header>

            <div class="cake-order-grid">
              <section class="cake-order-section">
                <h4>Cake specifications</h4>
                ${detailBlock("Cake type", request.cake_type, "Custom cake")}
                ${detailBlock("Size", request.size)}
                ${detailBlock("Flavour", request.flavour)}
                ${detailBlock("Message on cake", request.message_on_cake, "No message")}
              </section>

              <section class="cake-order-section">
                <h4>Customer requirements</h4>
                <div class="cake-requirements">
                  ${escapeHTML(cleanDetail(request.requirements, "No additional requirements provided."))}
                </div>
              </section>

              <section class="cake-order-section">
                <h4>Preferred date</h4>
                <p class="cake-date">
                  ${escapeHTML(formatCakeDate(request.preferred_date))}
                </p>

                <h4 class="cake-reference-heading">Reference</h4>
                ${imageMarkup}

                <p class="cake-submitted">
                  Submitted ${escapeHTML(formatCakeTimestamp(request.created_at))}
                </p>
              </section>

              <section class="cake-order-section cake-admin-section">
                <h4>Staff controls</h4>

                <label class="cake-field-label">
                  Order status
                  <select data-cake-status>
                    ${statusOptions}
                  </select>
                </label>

                <label class="cake-field-label">
                  Private staff notes
                  <textarea data-cake-notes
                    rows="4"
                    maxlength="2000"
                    placeholder="Internal notes for staff">${notes}</textarea>
                </label>

                <div class="cake-action-buttons">
                  <button
                    type="button"
                    class="cake-save-button"
                    data-save-cake
                    ${completed ? "disabled" : ""}
                  >
                    ${completed ? "Changes saved" : "Save changes"}
                  </button>

                  <button
                    type="button"
                    class="cake-complete-button"
                    data-complete-cake
                    ${completed ? "disabled" : ""}
                  >
                    ${completed ? "✓ Completed" : "✓ Mark Completed"}
                  </button>
                </div>
              </section>
            </div>
          </article>
        </td>
      </tr>
    `;
  }).join("");
}

async function saveCakeRequest(button, markCompleted = false) {
  if (isSavingCakeRequest) return;

  if (!currentUser || !currentAdminProfile || !supabaseClient) {
    alert("Sign in with an authorized admin account first.");
    return;
  }

  const row = button.closest("[data-cake-request]");
  if (!row) return;

  const id = row.dataset.cakeRequest;
  const statusInput = row.querySelector("[data-cake-status]");
  const notesInput = row.querySelector("[data-cake-notes]");

  if (!statusInput || !notesInput) return;

  if (markCompleted) {
    statusInput.value = "Completed";
  }

  if (!CAKE_STATUSES.includes(statusInput.value)) {
    alert("Select a valid cake request status.");
    return;
  }

  isSavingCakeRequest = true;

  const originalText = button.textContent;
  const buttons = row.querySelectorAll(
    "[data-save-cake], [data-complete-cake]"
  );

  buttons.forEach(item => {
    item.disabled = true;
  });

  button.textContent = markCompleted ? "Completing..." : "Saving...";

  try {
    const payload = {
      status: statusInput.value,
      staff_notes: notesInput.value.trim(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseClient
      .from(TABLE_CAKE_REQUESTS)
      .update(payload)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new Error(
        "No cake request was updated. Check your admin update permissions and Supabase policies."
      );
    }

    const request = cakeRequests.find(
      item => String(item.id) === String(id)
    );

    if (request) {
      request.status = payload.status;
      request.staff_notes = payload.staff_notes;
      request.updated_at = payload.updated_at;
    }

    renderCakeRequests();

    setMessage(
      globalMessage || authMessage,
      markCompleted
        ? "Cake request marked as completed."
        : "Cake request updated successfully.",
      "success"
    );
  } catch (error) {
    console.error("Could not save cake request:", error);

    alert(
      "Could not save the cake request.\n\n" + getErrorMessage(error)
    );

    buttons.forEach(item => {
      item.disabled = false;
    });

    button.textContent = originalText || "Save changes";
  } finally {
    isSavingCakeRequest = false;
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

  refreshCakeOrdersButton?.addEventListener("click", loadCakeRequests);

  cakeOrdersTable?.addEventListener("click", event => {
    const target = event.target;

    if (!(target instanceof Element)) return;

    const saveButton = target.closest("[data-save-cake]");
    const completeButton = target.closest("[data-complete-cake]");

    if (saveButton && cakeOrdersTable.contains(saveButton)) {
      saveCakeRequest(saveButton, false);
      return;
    }

    if (completeButton && cakeOrdersTable.contains(completeButton)) {
      const row = completeButton.closest("[data-cake-request]");
      const statusInput = row?.querySelector("[data-cake-status]");

      if (!row || !statusInput) return;

      if (statusInput.value === "Completed") {
        saveCakeRequest(completeButton, true);
        return;
      }

      const confirmed = window.confirm(
        "Mark this custom cake request as completed?"
      );

      if (confirmed) {
        saveCakeRequest(completeButton, true);
      }
    }
  });

  document.querySelectorAll("[data-close-dialog]").forEach(button => {
    button.addEventListener("click", closeProductDialog);
  });

  productDialog?.addEventListener("click", event => {
    if (event.target === productDialog) {
      closeProductDialog();
    }
  });

  productDialog?.addEventListener("close", () => {
    setMessage(formMessage, "");
  });

  setupNavigation();
}

setupEventListeners();
initializeAdmin();
