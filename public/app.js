// Updated: add invoice slippage quick buttons and "Same as signer" helper.
(() => {
  // ── Helpers ──────────────────────────────────────────────────────────

  const getInputValue = (id) => {
    const input = document.getElementById(id);
    if (!input) return "";
    return input.value ?? "";
  };

  const isChecked = (id) => {
    const input = document.getElementById(id);
    return Boolean(input && input.checked);
  };

  const setDisabled = (id, disabled) => {
    const input = document.getElementById(id);
    if (input) {
      input.disabled = disabled;
    }
  };

  const setHidden = (id, hidden) => {
    const el = document.getElementById(id);
    if (el) {
      el.hidden = hidden;
    }
  };

  const setStatus = (statusEl, message) => {
    statusEl.textContent = message;
  };

  const showError = (errorEl, message) => {
    errorEl.textContent = message;
    errorEl.hidden = false;
  };

  const clearError = (errorEl) => {
    errorEl.textContent = "";
    errorEl.hidden = true;
  };

  const parseJsonField = (value, fieldName, required) => {
    const trimmed = value.trim();
    if (!trimmed) {
      if (required) {
        throw new Error(`${fieldName} is required.`);
      }
      return undefined;
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      throw new Error(`Invalid JSON in ${fieldName}: ${message}`);
    }
  };

  const validatePrimaryAddresses = (addresses) => {
    const invalid = addresses.filter((address) => !address.startsWith("R"));
    if (invalid.length > 0) {
      throw new Error("Primary addresses must start with 'R'.");
    }
  };

  const parseAddressList = (value, fieldName) => {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`${fieldName} is required.`);
    }

    if (trimmed.startsWith("[") || trimmed.startsWith("\"")) {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const list = parsed.map((entry) => String(entry).trim()).filter(Boolean);
        if (list.length === 0) {
          throw new Error(`${fieldName} must include at least one address.`);
        }
        return list;
      }
      if (typeof parsed === "string" && parsed.trim()) {
        return [parsed.trim()];
      }
      throw new Error(`${fieldName} must be a JSON array or string.`);
    }

    const list = trimmed
      .split(/[,\n]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (list.length === 0) {
      throw new Error(`${fieldName} must include at least one address.`);
    }
    return list;
  };

  /**
   * Convert a decimal amount string (e.g. "0.5", "100") to a satoshi string
   * using integer arithmetic only (no floating-point loss). Assumes 8 decimals.
   */
  const SATOSHI_DECIMALS = 8;
  const SATOSHI_MULTIPLIER = 10 ** SATOSHI_DECIMALS; // 100_000_000

  const decimalToSatoshis = (input) => {
    const trimmed = input.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error("Amount must be a positive number (e.g. 0.5 or 100).");
    }

    const parts = trimmed.split(".");
    const wholePart = parts[0] || "0";
    let fracPart = parts[1] || "";

    if (fracPart.length > SATOSHI_DECIMALS) {
      throw new Error(`Amount cannot have more than ${SATOSHI_DECIMALS} decimal places.`);
    }

    // Pad fractional part to exactly 8 digits
    fracPart = fracPart.padEnd(SATOSHI_DECIMALS, "0");

    // Combine as integer string and strip leading zeros (keep at least "0")
    const combined = (wholePart + fracPart).replace(/^0+/, "") || "0";

    if (combined === "0") {
      throw new Error("Amount must be greater than zero.");
    }

    return combined;
  };

  /**
   * Convert a percent string (e.g. "5") to base-unit slippage string.
   * 100% = 100_000_000 (same scale as amount). So 1% = 1_000_000.
   */
  const percentToSlippageUnits = (input) => {
    const trimmed = input.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error("Slippage must be a positive number (e.g. 5 for 5%).");
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("Slippage must be a positive number.");
    }
    if (value > 100) {
      throw new Error("Slippage cannot exceed 100%.");
    }

    // 1% = 1_000_000 base units (same 8-decimal scale as amount)
    const units = Math.round(value * 1_000_000);
    if (units <= 0) {
      throw new Error("Slippage must be a positive number.");
    }
    return units.toString();
  };

  const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const I_ADDR_VERSION = 102;
  const REQUEST_ID_BYTES = 20;

  const concatBytes = (...arrays) => {
    const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    arrays.forEach((arr) => {
      merged.set(arr, offset);
      offset += arr.length;
    });
    return merged;
  };

  const sha256 = async (data) => {
    const cryptoObj = globalThis.crypto;
    if (!cryptoObj?.subtle) {
      throw new Error("Secure crypto is not available in this browser.");
    }
    const hashBuffer = await cryptoObj.subtle.digest("SHA-256", data);
    return new Uint8Array(hashBuffer);
  };

  const base58Encode = (bytes) => {
    let num = 0n;
    bytes.forEach((byte) => {
      num = (num << 8n) + BigInt(byte);
    });

    let encoded = "";
    while (num > 0n) {
      const remainder = num % 58n;
      encoded = BASE58_ALPHABET[Number(remainder)] + encoded;
      num = num / 58n;
    }

    let leadingZeros = 0;
    for (const byte of bytes) {
      if (byte === 0) leadingZeros += 1;
      else break;
    }

    return "1".repeat(leadingZeros) + (encoded || "");
  };

  const base58CheckEncode = async (version, payload) => {
    if (!Number.isInteger(version) || version < 0 || version > 0xffff) {
      throw new Error("Invalid address version.");
    }
    const versionBytes =
      version > 0xff ? new Uint8Array([version >> 8, version & 0xff]) : new Uint8Array([version]);
    const body = concatBytes(versionBytes, payload);
    const first = await sha256(body);
    const second = await sha256(first);
    const checksum = second.slice(0, 4);
    const full = concatBytes(body, checksum);
    return base58Encode(full);
  };

  const generateRequestId = async () => {
    const cryptoObj = globalThis.crypto;
    if (!cryptoObj?.getRandomValues || !cryptoObj?.subtle) {
      throw new Error("Secure crypto is not available in this browser.");
    }
    const payload = new Uint8Array(REQUEST_ID_BYTES);
    cryptoObj.getRandomValues(payload);
    return base58CheckEncode(I_ADDR_VERSION, payload);
  };

  const setupRequestIdGenerator = (inputEl, buttonEl, statusEl, errorEl) => {
    if (!inputEl || !buttonEl) return;

    buttonEl.addEventListener("click", async () => {
      clearError(errorEl);
      setStatus(statusEl, "Generating request ID...");
      buttonEl.disabled = true;

      try {
        inputEl.value = await generateRequestId();
        setStatus(statusEl, "Request ID generated.");
        setTimeout(() => setStatus(statusEl, ""), 2000);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to generate request ID.";
        showError(errorEl, message);
        setStatus(statusEl, "");
      } finally {
        buttonEl.disabled = false;
      }
    });
  };

  // ── Global Signing ID ─────────────────────────────────────────────

  const getGlobalSigningId = () => getInputValue("global-signing-id").trim();

  const loadIdentities = async () => {
    const select = document.getElementById("global-signing-id-select");
    if (!select) return;

    try {
      const res = await fetch("/api/identities");
      const data = await res.json();
      const identities = Array.isArray(data.identities) ? data.identities : [];

      select.innerHTML = "";

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = identities.length > 0
        ? "Select an identity..."
        : "No identities found";
      select.appendChild(placeholder);

      identities.forEach((id) => {
        const opt = document.createElement("option");
        opt.value = id.iAddress;
        opt.textContent = `${id.name}@ (${id.iAddress})`;
        select.appendChild(opt);
      });
    } catch {
      select.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Could not load identities";
      select.appendChild(opt);
    }
  };

  const wireGlobalSigningIdDropdown = () => {
    const select = document.getElementById("global-signing-id-select");
    const input = document.getElementById("global-signing-id");
    if (!select || !input) return;

    select.addEventListener("change", () => {
      if (select.value) {
        input.value = select.value;
      }
    });
  };

  // ── Currency List (Invoice) ────────────────────────────────────────

  let cachedCurrencies = [];

  const filterCurrencies = (query) => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return cachedCurrencies;

    return cachedCurrencies.filter((currency) => {
      const haystack = [
        currency.name,
        currency.currencyId,
        currency.fullyQualifiedName,
        currency.launchstate,
        currency.systemtype,
        currency.hasBalance ? "wallet" : ""
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmed);
    });
  };

  const renderCurrencyOptions = (query = "") => {
    const select = document.getElementById("invoice-currency-id-select");
    if (!select) return;

    const filtered = filterCurrencies(query);
    const previousValue = select.value;

    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    if (cachedCurrencies.length === 0) {
      placeholder.textContent = "No currencies available";
    } else if (filtered.length === 0) {
      placeholder.textContent = "No matches";
    } else {
      placeholder.textContent = "Select a currency...";
    }
    select.appendChild(placeholder);

    filtered.forEach((currency) => {
      const opt = document.createElement("option");
      const stateLabel = currency.launchstate === "prelaunch"
        ? "preconvert"
        : currency.launchstate;
      const systemLabel = currency.systemtype ? `/${currency.systemtype}` : "";
      const walletLabel = currency.hasBalance ? "wallet" : "";
      const meta = [stateLabel ? `${stateLabel}${systemLabel}` : null, walletLabel]
        .filter(Boolean)
        .join(", ");
      opt.value = currency.currencyId;
      opt.textContent = meta
        ? `${currency.name} (${meta}) — ${currency.currencyId}`
        : `${currency.name} — ${currency.currencyId}`;
      select.appendChild(opt);
    });

    select.disabled = cachedCurrencies.length === 0;

    if (previousValue && filtered.some((currency) => currency.currencyId === previousValue)) {
      select.value = previousValue;
    }
  };

  const loadCurrencies = async () => {
    const select = document.getElementById("invoice-currency-id-select");
    if (!select) return;

    try {
      const res = await fetch("/api/currencies");
      const data = await res.json();
      cachedCurrencies = Array.isArray(data.currencies) ? data.currencies : [];
      renderCurrencyOptions(getInputValue("invoice-currency-search"));
    } catch {
      cachedCurrencies = [];
      renderCurrencyOptions(getInputValue("invoice-currency-search"));
    }
  };

  const wireCurrencySearch = () => {
    const searchInput = document.getElementById("invoice-currency-search");
    if (!searchInput) return;

    searchInput.addEventListener("input", () => {
      renderCurrencyOptions(searchInput.value);
    });
  };

  // ── Reference Card Copy Buttons ─────────────────────────────────────

  const setupCopyButtons = () => {
    document.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        const text = button.getAttribute("data-copy");
        if (!text) return;

        try {
          await navigator.clipboard.writeText(text);
          const original = button.textContent;
          button.textContent = "Copied!";
          button.classList.add("copied");
          setTimeout(() => {
            button.textContent = original;
            button.classList.remove("copied");
          }, 1500);
        } catch {
          button.textContent = "Failed";
          setTimeout(() => {
            button.textContent = "Copy";
          }, 1500);
        }
      });
    });
  };

  // ── Tabs ─────────────────────────────────────────────────────────────

  const setupTabs = () => {
    const buttons = Array.from(document.querySelectorAll(".tab-button"));
    const panels = Array.from(document.querySelectorAll("[data-tab-panel]"));
    if (buttons.length === 0 || panels.length === 0) return;

    const setActive = (tabId) => {
      buttons.forEach((button) => {
        const active = button.dataset.tab === tabId;
        button.setAttribute("aria-pressed", String(active));
      });
      panels.forEach((panel) => {
        const active = panel.dataset.tabPanel === tabId;
        panel.hidden = !active;
      });
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => setActive(button.dataset.tab));
    });

    setActive(buttons[0].dataset.tab);
  };

  // ── Update Identity Form ─────────────────────────────────────────────

  const setupUpdateForm = () => {
    const form = document.getElementById("update-form");
    const statusEl = document.getElementById("update-status");
    const errorEl = document.getElementById("update-error");
    const resultEl = document.getElementById("update-result");
    const qrImage = document.getElementById("update-qr-image");
    const deeplinkEl = document.getElementById("update-deeplink");
    const copyButton = document.getElementById("update-copy-button");
    const submitButton = document.getElementById("update-submit-button");
    const requestIdInput = document.getElementById("update-request-id");
    const requestIdGenerateButton = document.getElementById("update-request-id-generate");

    if (
      !form ||
      !statusEl ||
      !errorEl ||
      !resultEl ||
      !qrImage ||
      !deeplinkEl ||
      !copyButton ||
      !submitButton
    ) {
      return;
    }

    const toggleOptionalFields = () => {
      setDisabled("update-content-multimap", !isChecked("update-enable-content-multimap"));
      setDisabled("update-primary-addresses", !isChecked("update-enable-primary-addresses"));
      setDisabled("update-revocation-authority", !isChecked("update-enable-revocation-authority"));
      setDisabled("update-recovery-authority", !isChecked("update-enable-recovery-authority"));
    };

    [
      "update-enable-content-multimap",
      "update-enable-primary-addresses",
      "update-enable-revocation-authority",
      "update-enable-recovery-authority"
    ].forEach((id) => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener("change", toggleOptionalFields);
      }
    });
    toggleOptionalFields();
    setupRequestIdGenerator(requestIdInput, requestIdGenerateButton, statusEl, errorEl);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearError(errorEl);
      resultEl.hidden = true;
      setStatus(statusEl, "Generating QR code...");
      submitButton.disabled = true;

      try {
        const signingId = getGlobalSigningId();
        if (!signingId) {
          throw new Error("Signing ID is required (set in the global header above).");
        }
        const requestId = getInputValue("update-request-id").trim();
        const identityChangesText = getInputValue("update-identity-changes");
        const redirectsText = getInputValue("update-redirects");

        const identityChanges = parseJsonField(
          identityChangesText,
          "Identity changes JSON",
          true
        );
        if (!identityChanges || typeof identityChanges !== "object" || Array.isArray(identityChanges)) {
          throw new Error("Identity changes JSON must be an object.");
        }

        if (isChecked("update-enable-content-multimap")) {
          const contentMultimap = parseJsonField(
            getInputValue("update-content-multimap"),
            "Content multimap JSON",
            true
          );
          if (!contentMultimap || typeof contentMultimap !== "object" || Array.isArray(contentMultimap)) {
            throw new Error("Content multimap JSON must be an object.");
          }
          identityChanges.contentmultimap = contentMultimap;
        } else if (Object.prototype.hasOwnProperty.call(identityChanges, "contentmultimap")) {
          delete identityChanges.contentmultimap;
        }

        if (isChecked("update-enable-primary-addresses")) {
          const list = parseAddressList(
            getInputValue("update-primary-addresses"),
            "Primary addresses"
          );
          validatePrimaryAddresses(list);
          identityChanges.primaryaddresses = list;
        }

        if (isChecked("update-enable-revocation-authority")) {
          const value = getInputValue("update-revocation-authority").trim();
          if (!value) {
            throw new Error("Revocation authority is required.");
          }
          identityChanges.revocationauthority = value;
        }

        if (isChecked("update-enable-recovery-authority")) {
          const value = getInputValue("update-recovery-authority").trim();
          if (!value) {
            throw new Error("Recovery authority is required.");
          }
          identityChanges.recoveryauthority = value;
        }
        const redirects = parseJsonField(redirectsText, "Redirects JSON", false);

        const payload = {
          signingId,
          requestId: requestId || undefined,
          identityChanges,
          redirects
        };

        const response = await fetch("/api/generate-qr", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Failed to generate QR.");
        }

        qrImage.src = data.qrDataUrl;
        qrImage.alt = "QR Code for request";
        deeplinkEl.value = data.deeplink;
        resultEl.hidden = false;
        setStatus(statusEl, "QR generated.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error.";
        showError(errorEl, message);
        setStatus(statusEl, "");
      } finally {
        submitButton.disabled = false;
      }
    });

    copyButton.addEventListener("click", async () => {
      if (!deeplinkEl.value) return;
      try {
        await navigator.clipboard.writeText(deeplinkEl.value);
        setStatus(statusEl, "Deeplink copied.");
        setTimeout(() => setStatus(statusEl, ""), 2000);
      } catch (error) {
        setStatus(statusEl, "Copy failed. Select and copy manually.");
      }
    });
  };

  // ── Authentication Form ──────────────────────────────────────────────

  const setupAuthForm = () => {
    const form = document.getElementById("auth-form");
    const statusEl = document.getElementById("auth-status");
    const errorEl = document.getElementById("auth-error");
    const resultEl = document.getElementById("auth-result");
    const qrImage = document.getElementById("auth-qr-image");
    const deeplinkEl = document.getElementById("auth-deeplink");
    const copyButton = document.getElementById("auth-copy-button");
    const submitButton = document.getElementById("auth-submit-button");
    const constraintTypeEl = document.getElementById("auth-recipient-constraint-type");
    const constraintIdentityEl = document.getElementById("auth-recipient-constraint-identity");
    const requestIdInput = document.getElementById("auth-request-id");
    const requestIdGenerateButton = document.getElementById("auth-request-id-generate");

    if (
      !form ||
      !statusEl ||
      !errorEl ||
      !resultEl ||
      !qrImage ||
      !deeplinkEl ||
      !copyButton ||
      !submitButton ||
      !constraintTypeEl ||
      !constraintIdentityEl
    ) {
      return;
    }

    const toggleConstraintIdentity = () => {
      const hasType = constraintTypeEl.value !== "";
      constraintIdentityEl.disabled = !hasType;
      if (!hasType) {
        constraintIdentityEl.value = "";
      }
    };

    constraintTypeEl.addEventListener("change", toggleConstraintIdentity);
    toggleConstraintIdentity();
    setupRequestIdGenerator(requestIdInput, requestIdGenerateButton, statusEl, errorEl);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearError(errorEl);
      resultEl.hidden = true;
      setStatus(statusEl, "Generating QR code...");
      submitButton.disabled = true;

      try {
        const signingId = getGlobalSigningId();
        if (!signingId) {
          throw new Error("Signing ID is required (set in the global header above).");
        }

        const requestId = getInputValue("auth-request-id").trim();
        if (!requestId) {
          throw new Error("Request ID is required.");
        }
        const expiryTimeRaw = getInputValue("auth-expiry-time").trim();
        const recipientConstraintType = constraintTypeEl.value.trim();
        const recipientConstraintIdentity = getInputValue("auth-recipient-constraint-identity").trim();
        const redirectsText = getInputValue("auth-redirects");

        let expiryTime;
        if (expiryTimeRaw) {
          const parsed = Number(expiryTimeRaw);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error("Expiry time must be a positive unix timestamp.");
          }
          expiryTime = Math.floor(parsed);
        }

        if (recipientConstraintType && !recipientConstraintIdentity) {
          throw new Error("Recipient constraint identity is required when a constraint type is set.");
        }

        const redirects = parseJsonField(redirectsText, "Redirects JSON", false);

        const payload = {
          signingId,
          requestId,
          expiryTime,
          recipientConstraintType: recipientConstraintType || undefined,
          recipientConstraintIdentity: recipientConstraintIdentity || undefined,
          redirects
        };

        const response = await fetch("/api/generate-auth-qr", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Failed to generate QR.");
        }

        qrImage.src = data.qrDataUrl;
        qrImage.alt = "QR Code for request";
        deeplinkEl.value = data.deeplink;
        resultEl.hidden = false;
        setStatus(statusEl, "QR generated.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error.";
        showError(errorEl, message);
        setStatus(statusEl, "");
      } finally {
        submitButton.disabled = false;
      }
    });

    copyButton.addEventListener("click", async () => {
      if (!deeplinkEl.value) return;
      try {
        await navigator.clipboard.writeText(deeplinkEl.value);
        setStatus(statusEl, "Deeplink copied.");
        setTimeout(() => setStatus(statusEl, ""), 2000);
      } catch (error) {
        setStatus(statusEl, "Copy failed. Select and copy manually.");
      }
    });
  };

  // ── Invoice Form ────────────────────────────────────────────────────

  const setupInvoiceForm = () => {
    const form = document.getElementById("invoice-form");
    const statusEl = document.getElementById("invoice-status");
    const errorEl = document.getElementById("invoice-error");
    const resultEl = document.getElementById("invoice-result");
    const qrImage = document.getElementById("invoice-qr-image");
    const deeplinkEl = document.getElementById("invoice-deeplink");
    const copyButton = document.getElementById("invoice-copy-button");
    const submitButton = document.getElementById("invoice-submit-button");
    const sameAsSignerButton = document.getElementById("invoice-destination-same-as-signer");
    const slippageInput = document.getElementById("invoice-max-slippage");

    if (
      !form ||
      !statusEl ||
      !errorEl ||
      !resultEl ||
      !qrImage ||
      !deeplinkEl ||
      !copyButton ||
      !submitButton
    ) {
      return;
    }

    // Toggle conditional fields based on flag checkboxes
    const toggleInvoiceFields = () => {
      const anyAmount = isChecked("invoice-accepts-any-amount");
      setDisabled("invoice-amount", anyAmount);

      const anyDest = isChecked("invoice-accepts-any-destination");
      setDisabled("invoice-destination-type", anyDest);
      setDisabled("invoice-destination-address", anyDest);

      setHidden("invoice-slippage-group", !isChecked("invoice-accepts-conversion"));
      setHidden("invoice-expiry-group", !isChecked("invoice-expires"));
      setHidden("invoice-accepted-systems-group", !isChecked("invoice-accepts-non-verus"));
      setHidden("invoice-tag-group", !isChecked("invoice-is-tagged"));
      setDisabled("invoice-destination-same-as-signer", anyDest);
    };

    [
      "invoice-accepts-any-amount",
      "invoice-accepts-any-destination",
      "invoice-accepts-conversion",
      "invoice-expires",
      "invoice-accepts-non-verus",
      "invoice-is-tagged"
    ].forEach((id) => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener("change", toggleInvoiceFields);
      }
    });
    toggleInvoiceFields();

    if (slippageInput) {
      const slippageButtons = form.querySelectorAll("[data-slippage-value]");
      slippageButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const value = button.getAttribute("data-slippage-value") || "";
          slippageInput.value = value;
          slippageInput.focus();
        });
      });
    }

    if (sameAsSignerButton) {
      sameAsSignerButton.addEventListener("click", () => {
        clearError(errorEl);
        const signingId = getGlobalSigningId();
        if (!signingId) {
          showError(errorEl, "Signing ID is required to use \"Same as signer\".");
          return;
        }

        const destinationType = document.getElementById("invoice-destination-type");
        const destinationAddress = document.getElementById("invoice-destination-address");
        if (destinationType) {
          destinationType.value = "id";
        }
        if (destinationAddress) {
          destinationAddress.value = signingId;
          destinationAddress.focus();
        }
      });
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearError(errorEl);
      resultEl.hidden = true;
      setStatus(statusEl, "Generating QR code...");
      submitButton.disabled = true;

      try {
        const signed = isChecked("invoice-signed");

        let signingId;
        if (signed) {
          signingId = getGlobalSigningId();
          if (!signingId) {
            throw new Error("Signing ID is required for signed invoices (set in the global header above).");
          }
        }

        const requestedCurrencyId = getInputValue("invoice-currency-id-select").trim();
        if (!requestedCurrencyId) {
          throw new Error("Requested Currency ID is required.");
        }

        const acceptsAnyAmount = isChecked("invoice-accepts-any-amount");
        const acceptsAnyDestination = isChecked("invoice-accepts-any-destination");

        let amount;
        if (!acceptsAnyAmount) {
          const amountInput = getInputValue("invoice-amount").trim();
          if (!amountInput) {
            throw new Error("Amount is required when 'accepts any amount' is off.");
          }
          amount = decimalToSatoshis(amountInput);
        }

        let destinationType;
        let destinationAddress;
        if (!acceptsAnyDestination) {
          destinationType = getInputValue("invoice-destination-type");
          destinationAddress = getInputValue("invoice-destination-address").trim();
          if (!destinationAddress) {
            throw new Error("Destination address is required when 'accepts any destination' is off.");
          }
        }

        const redirectsText = getInputValue("invoice-redirects");
        const redirects = parseJsonField(redirectsText, "Redirects JSON", false);

        const payload = {
          signed,
          signingId: signingId || undefined,
          requestedCurrencyId,
          amount: amount || undefined,
          destinationType: destinationType || undefined,
          destinationAddress: destinationAddress || undefined,
          acceptsAnyAmount,
          acceptsAnyDestination,
          acceptsConversion: isChecked("invoice-accepts-conversion"),
          maxEstimatedSlippage: (() => {
            const raw = getInputValue("invoice-max-slippage").trim();
            return raw ? percentToSlippageUnits(raw) : undefined;
          })(),
          expires: isChecked("invoice-expires"),
          expiryHeight: getInputValue("invoice-expiry-height").trim() || undefined,
          acceptsNonVerusSystems: isChecked("invoice-accepts-non-verus"),
          acceptedSystems: getInputValue("invoice-accepted-systems").trim() || undefined,
          isTestnet: isChecked("invoice-is-testnet"),
          isPreconvert: isChecked("invoice-is-preconvert"),
          isTagged: isChecked("invoice-is-tagged"),
          tagAddress: getInputValue("invoice-tag-address").trim() || undefined,
          redirects
        };

        const response = await fetch("/api/generate-invoice-qr", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Failed to generate QR.");
        }

        qrImage.src = data.qrDataUrl;
        qrImage.alt = "QR Code for invoice";
        deeplinkEl.value = data.deeplink;
        resultEl.hidden = false;
        setStatus(statusEl, "QR generated.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error.";
        showError(errorEl, message);
        setStatus(statusEl, "");
      } finally {
        submitButton.disabled = false;
      }
    });

    copyButton.addEventListener("click", async () => {
      if (!deeplinkEl.value) return;
      try {
        await navigator.clipboard.writeText(deeplinkEl.value);
        setStatus(statusEl, "Deeplink copied.");
        setTimeout(() => setStatus(statusEl, ""), 2000);
      } catch (error) {
        setStatus(statusEl, "Copy failed. Select and copy manually.");
      }
    });
  };

  // ── App Encryption Form ─────────────────────────────────────────────

  const setupAppEncryptionForm = () => {
    const form = document.getElementById("app-encryption-form");
    const statusEl = document.getElementById("app-encryption-status");
    const errorEl = document.getElementById("app-encryption-error");
    const resultEl = document.getElementById("app-encryption-result");
    const qrImage = document.getElementById("app-encryption-qr-image");
    const deeplinkEl = document.getElementById("app-encryption-deeplink");
    const copyButton = document.getElementById("app-encryption-copy-button");
    const submitButton = document.getElementById("app-encryption-submit-button");
    const requestIdInput = document.getElementById("app-encryption-request-id");
    const requestIdGenerateButton = document.getElementById("app-encryption-request-id-generate");

    if (
      !form ||
      !statusEl ||
      !errorEl ||
      !resultEl ||
      !qrImage ||
      !deeplinkEl ||
      !copyButton ||
      !submitButton
    ) {
      return;
    }

    setupRequestIdGenerator(requestIdInput, requestIdGenerateButton, statusEl, errorEl);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearError(errorEl);
      resultEl.hidden = true;
      setStatus(statusEl, "Generating QR code...");
      submitButton.disabled = true;

      try {
        const signingId = getGlobalSigningId();
        if (!signingId) {
          throw new Error("Signing ID is required (set in the global header above).");
        }

        const encryptToZAddress = getInputValue("app-encryption-zaddress").trim() || undefined;
        const derivationNumberRaw = getInputValue("app-encryption-derivation-number").trim();
        const derivationID = getInputValue("app-encryption-derivation-id").trim() || undefined;
        const requestId = getInputValue("app-encryption-request-id").trim() || undefined;
        const returnEsk = isChecked("app-encryption-return-esk");
        const redirectsText = getInputValue("app-encryption-redirects");

        let derivationNumber = 0;
        if (derivationNumberRaw) {
          const parsed = Number(derivationNumberRaw);
          if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
            throw new Error("Derivation number must be a non-negative integer.");
          }
          derivationNumber = parsed;
        }

        if (encryptToZAddress && !encryptToZAddress.startsWith("zs1")) {
          throw new Error("Z-address must start with 'zs1'.");
        }

        const redirects = parseJsonField(redirectsText, "Redirects JSON", true);
        if (!Array.isArray(redirects) || redirects.length === 0) {
          throw new Error("Redirects JSON must be a non-empty array.");
        }

        const payload = {
          signingId,
          encryptToZAddress,
          derivationNumber,
          derivationID,
          requestId,
          returnEsk,
          redirects
        };

        const response = await fetch("/api/generate-app-encryption-qr", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Failed to generate QR.");
        }

        qrImage.src = data.qrDataUrl;
        qrImage.alt = "QR Code for app encryption request";
        deeplinkEl.value = data.deeplink;
        resultEl.hidden = false;
        setStatus(statusEl, "QR generated.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error.";
        showError(errorEl, message);
        setStatus(statusEl, "");
      } finally {
        submitButton.disabled = false;
      }
    });

    copyButton.addEventListener("click", async () => {
      if (!deeplinkEl.value) return;
      try {
        await navigator.clipboard.writeText(deeplinkEl.value);
        setStatus(statusEl, "Deeplink copied.");
        setTimeout(() => setStatus(statusEl, ""), 2000);
      } catch (error) {
        setStatus(statusEl, "Copy failed. Select and copy manually.");
      }
    });
  };

  // ── Data Packet Form ────────────────────────────────────────────────

  const setupDataPacketForm = () => {
    const form = document.getElementById("data-packet-form");
    const statusEl = document.getElementById("data-packet-status");
    const errorEl = document.getElementById("data-packet-error");
    const resultEl = document.getElementById("data-packet-result");
    const qrImage = document.getElementById("data-packet-qr-image");
    const deeplinkEl = document.getElementById("data-packet-deeplink");
    const copyButton = document.getElementById("data-packet-copy-button");
    const submitButton = document.getElementById("data-packet-submit-button");
    const requestIdInput = document.getElementById("data-packet-request-id");
    const requestIdGenerateButton = document.getElementById("data-packet-request-id-generate");
    const flagHasRequestIdCheckbox = document.getElementById("data-packet-flag-has-request-id");
    const flagHasStatementsCheckbox = document.getElementById("data-packet-flag-has-statements");
    const flagHasSignatureCheckbox = document.getElementById("data-packet-flag-has-signature");
    const flagForUsersSignatureCheckbox = document.getElementById("data-packet-flag-for-users-signature");
    const flagHasUrlCheckbox = document.getElementById("data-packet-flag-has-url");
    const requestIdGroup = document.getElementById("data-packet-request-id-group");
    const statementsGroup = document.getElementById("data-packet-statements-group");
    const signatureGroup = document.getElementById("data-packet-signature-group");
    const urlGroup = document.getElementById("data-packet-url-group");
    const downloadUrlInput = document.getElementById("data-packet-download-url");
    const datahashGroup = document.getElementById("data-packet-datahash-group");
    const datahashInput = document.getElementById("data-packet-datahash");
    const signableObjectsTextarea = document.getElementById("data-packet-signable-objects");
    const signableObjectsTag = document.getElementById("data-packet-signable-objects-tag");
    const signableObjectsHelp = document.getElementById("data-packet-signable-objects-help");
    const signButton = document.getElementById("data-packet-sign-button");
    const signStatus = document.getElementById("data-packet-sign-status");
    const signatureResult = document.getElementById("data-packet-signature-result");
    const signatureJsonEl = document.getElementById("data-packet-signature-json");

    // Track signature state
    let dataPacketSignatureData = null;
    // Store original signable objects value when URL mode is enabled
    let originalSignableObjectsValue = "";

    if (
      !form ||
      !statusEl ||
      !errorEl ||
      !resultEl ||
      !qrImage ||
      !deeplinkEl ||
      !copyButton ||
      !submitButton
    ) {
      return;
    }

    // Reset signature when any relevant input changes
    const resetSignature = () => {
      dataPacketSignatureData = null;
      if (signatureResult) signatureResult.hidden = true;
      if (signatureJsonEl) signatureJsonEl.value = "";
    };

    // Generate URL descriptor and update signable objects
    const updateSignableObjectsWithUrl = () => {
      if (!downloadUrlInput || !signableObjectsTextarea) return;
      const url = downloadUrlInput.value.trim();
      const datahash = datahashInput?.value.trim() || "";
      if (!url) {
        signableObjectsTextarea.value = "[]";
        return;
      }
      // Show the expected structure (actual generation happens on backend)
      const preview = JSON.stringify([{
        "version": 1,
        "objectdata": {
          "iP3euVSzNcXUrLNHnQnR9G6q8jeYuGSxgw": {
            "version": 1,
            "flags": 0,
            "datahash": datahash,
            "url": url,
            "type": 2
          }
        }
      }], null, 2);
      signableObjectsTextarea.value = preview;
    };

    // Toggle datahash visibility based on both Has Signature and Has URL flags
    const toggleDatahashVisibility = () => {
      if (datahashGroup) {
        const showDatahash = flagHasSignatureCheckbox?.checked && flagHasUrlCheckbox?.checked;
        datahashGroup.hidden = !showDatahash;
      }
    };

    // Handle mutual exclusivity between "Has Signature" and "For User's Signature"
    const handleSignatureFlagExclusivity = (changedCheckbox) => {
      if (changedCheckbox === flagHasSignatureCheckbox && flagHasSignatureCheckbox?.checked) {
        if (flagForUsersSignatureCheckbox) {
          flagForUsersSignatureCheckbox.checked = false;
        }
      } else if (changedCheckbox === flagForUsersSignatureCheckbox && flagForUsersSignatureCheckbox?.checked) {
        if (flagHasSignatureCheckbox) {
          flagHasSignatureCheckbox.checked = false;
          resetSignature();
        }
      }
    };

    // Toggle conditional fields based on flag checkboxes
    const toggleConditionalFields = () => {
      if (requestIdGroup) {
        requestIdGroup.hidden = !flagHasRequestIdCheckbox?.checked;
      }
      if (statementsGroup) {
        statementsGroup.hidden = !flagHasStatementsCheckbox?.checked;
      }
      if (signatureGroup) {
        signatureGroup.hidden = !flagHasSignatureCheckbox?.checked;
        // Reset signature when flag is toggled off
        if (!flagHasSignatureCheckbox?.checked) {
          resetSignature();
        }
      }
      if (urlGroup) {
        urlGroup.hidden = !flagHasUrlCheckbox?.checked;
      }
      // Handle signable objects readonly state based on URL flag
      if (signableObjectsTextarea) {
        const urlMode = flagHasUrlCheckbox?.checked;
        signableObjectsTextarea.readOnly = urlMode;
        if (urlMode) {
          // Save original value and update with URL descriptor
          if (!signableObjectsTextarea.hasAttribute("data-url-mode")) {
            originalSignableObjectsValue = signableObjectsTextarea.value;
            signableObjectsTextarea.setAttribute("data-url-mode", "true");
          }
          updateSignableObjectsWithUrl();
        } else {
          // Restore original value
          if (signableObjectsTextarea.hasAttribute("data-url-mode")) {
            signableObjectsTextarea.value = originalSignableObjectsValue;
            signableObjectsTextarea.removeAttribute("data-url-mode");
          }
        }
        // Update tag and help text
        if (signableObjectsTag) {
          signableObjectsTag.textContent = urlMode ? "auto-generated" : "optional";
          signableObjectsTag.className = urlMode ? "tag" : "tag optional";
        }
        if (signableObjectsHelp) {
          signableObjectsHelp.textContent = urlMode 
            ? "Auto-generated from the Download URL above. Contains a CrossChainDataRef with the URL."
            : "Array of DataDescriptor objects. Each needs: version, label, objectdata (hex), flags.";
        }
      }
    };

    if (flagHasRequestIdCheckbox) {
      flagHasRequestIdCheckbox.addEventListener("change", toggleConditionalFields);
    }
    if (flagHasStatementsCheckbox) {
      flagHasStatementsCheckbox.addEventListener("change", toggleConditionalFields);
    }
    if (flagHasSignatureCheckbox) {
      flagHasSignatureCheckbox.addEventListener("change", () => {
        handleSignatureFlagExclusivity(flagHasSignatureCheckbox);
        toggleConditionalFields();
        toggleDatahashVisibility();
        if (flagHasUrlCheckbox?.checked) {
          updateSignableObjectsWithUrl();
        }
        resetSignature();
      });
    }
    if (flagForUsersSignatureCheckbox) {
      flagForUsersSignatureCheckbox.addEventListener("change", () => {
        handleSignatureFlagExclusivity(flagForUsersSignatureCheckbox);
        toggleConditionalFields();
        toggleDatahashVisibility();
      });
    }
    if (flagHasUrlCheckbox) {
      flagHasUrlCheckbox.addEventListener("change", () => {
        toggleConditionalFields();
        toggleDatahashVisibility();
        resetSignature();
      });
    }
    if (downloadUrlInput) {
      downloadUrlInput.addEventListener("input", () => {
        if (flagHasUrlCheckbox?.checked) {
          updateSignableObjectsWithUrl();
        }
        resetSignature();
      });
    }
    if (datahashInput) {
      datahashInput.addEventListener("input", () => {
        if (flagHasUrlCheckbox?.checked) {
          updateSignableObjectsWithUrl();
        }
        resetSignature();
      });
    }
    toggleConditionalFields();
    toggleDatahashVisibility();

    // Reset signature when inputs change
    const inputsToWatch = [
      "data-packet-signable-objects",
      "data-packet-statements",
      "data-packet-request-id",
      "data-packet-download-url",
      "data-packet-datahash"
    ];
    inputsToWatch.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", resetSignature);
      }
    });

    // Also reset when flag checkboxes change (except has-signature itself)
    const flagsToWatch = [
      "data-packet-flag-has-request-id",
      "data-packet-flag-has-statements",
      "data-packet-flag-for-users-signature",
      "data-packet-flag-for-transmittal",
      "data-packet-flag-has-url"
    ];
    flagsToWatch.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("change", resetSignature);
      }
    });

    // Sign button handler
    if (signButton) {
      signButton.addEventListener("click", async () => {
        clearError(errorEl);
        if (signStatus) setStatus(signStatus, "Signing...");
        signButton.disabled = true;

        try {
          const signingId = getGlobalSigningId();
          if (!signingId) {
            throw new Error("Signing ID is required (set in the global header above).");
          }

          const flagHasRequestId = isChecked("data-packet-flag-has-request-id");
          const flagHasStatements = isChecked("data-packet-flag-has-statements");
          const flagHasSignature = isChecked("data-packet-flag-has-signature");
          const flagForUsersSignature = isChecked("data-packet-flag-for-users-signature");
          const flagForTransmittalToUser = isChecked("data-packet-flag-for-transmittal");
          const flagHasUrlForDownload = isChecked("data-packet-flag-has-url");

          const signableObjectsText = getInputValue("data-packet-signable-objects");
          const statementsText = getInputValue("data-packet-statements");
          const requestId = getInputValue("data-packet-request-id").trim() || undefined;
          const downloadUrl = getInputValue("data-packet-download-url").trim() || undefined;
          const dataHash = getInputValue("data-packet-datahash").trim() || undefined;

          const signableObjects = parseJsonField(signableObjectsText, "Signable Objects JSON", false);
          const statements = parseJsonField(statementsText, "Statements JSON", false);

          if (flagHasStatements && (!statements || !Array.isArray(statements) || statements.length === 0)) {
            throw new Error("Statements are required when 'Has Statements' flag is checked.");
          }

          if (flagHasRequestId && !requestId) {
            throw new Error("Request ID is required when 'Has Request ID' flag is checked.");
          }

          if (flagHasUrlForDownload && !downloadUrl) {
            throw new Error("Download URL is required when 'Has URL for Download' flag is checked.");
          }

          // Validate dataHash if provided
          if (dataHash && !/^[0-9a-fA-F]{64}$/.test(dataHash)) {
            throw new Error("Data hash must be exactly 32 bytes (64 hex characters).");
          }

          const payload = {
            signingId,
            flagHasRequestId,
            flagHasStatements,
            flagHasSignature,
            flagForUsersSignature,
            flagForTransmittalToUser,
            flagHasUrlForDownload,
            signableObjects,
            statements,
            requestId,
            downloadUrl,
            dataHash
          };

          const response = await fetch("/api/sign-data-packet", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });

          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data.error || "Failed to sign data packet.");
          }

          dataPacketSignatureData = data.signatureData;
          if (signatureJsonEl) {
            signatureJsonEl.value = JSON.stringify(data.signatureData, null, 2);
          }
          if (signatureResult) {
            signatureResult.hidden = false;
          }
          if (signStatus) setStatus(signStatus, "");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unexpected error.";
          showError(errorEl, message);
          if (signStatus) setStatus(signStatus, "");
        } finally {
          signButton.disabled = false;
        }
      });
    }

    setupRequestIdGenerator(requestIdInput, requestIdGenerateButton, statusEl, errorEl);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearError(errorEl);
      resultEl.hidden = true;
      setStatus(statusEl, "Generating QR code...");
      submitButton.disabled = true;

      try {
        // Check if signature is required but not present
        const flagHasSignature = isChecked("data-packet-flag-has-signature");
        if (flagHasSignature && !dataPacketSignatureData) {
          throw new Error("You must sign the DataPacket before generating the QR code when 'Has Signature' is checked.");
        }
        const signingId = getGlobalSigningId();
        if (!signingId) {
          throw new Error("Signing ID is required (set in the global header above).");
        }

        const flagHasRequestId = isChecked("data-packet-flag-has-request-id");
        const flagHasStatements = isChecked("data-packet-flag-has-statements");
        const flagForUsersSignature = isChecked("data-packet-flag-for-users-signature");
        const flagForTransmittalToUser = isChecked("data-packet-flag-for-transmittal");
        const flagHasUrlForDownload = isChecked("data-packet-flag-has-url");

        const signableObjectsText = getInputValue("data-packet-signable-objects");
        const statementsText = getInputValue("data-packet-statements");
        const requestId = getInputValue("data-packet-request-id").trim() || undefined;
        const redirectsText = getInputValue("data-packet-redirects");
        const downloadUrl = getInputValue("data-packet-download-url").trim() || undefined;
        const dataHash = getInputValue("data-packet-datahash").trim() || undefined;

        const signableObjects = parseJsonField(signableObjectsText, "Signable Objects JSON", false);
        const statements = parseJsonField(statementsText, "Statements JSON", false);
        const redirects = parseJsonField(redirectsText, "Redirects JSON", true);

        if (!Array.isArray(redirects) || redirects.length === 0) {
          throw new Error("Redirects JSON must be a non-empty array.");
        }

        if (flagHasStatements && (!statements || !Array.isArray(statements) || statements.length === 0)) {
          throw new Error("Statements are required when 'Has Statements' flag is checked.");
        }

        if (flagHasRequestId && !requestId) {
          throw new Error("Request ID is required when 'Has Request ID' flag is checked.");
        }

        if (flagHasUrlForDownload && !downloadUrl) {
          throw new Error("Download URL is required when 'Has URL for Download' flag is checked.");
        }

        // Validate dataHash if provided
        if (dataHash && !/^[0-9a-fA-F]{64}$/.test(dataHash)) {
          throw new Error("Data hash must be exactly 32 bytes (64 hex characters).");
        }

        const payload = {
          signingId,
          flagHasRequestId,
          flagHasStatements,
          flagHasSignature,
          flagForUsersSignature,
          flagForTransmittalToUser,
          flagHasUrlForDownload,
          signableObjects,
          statements,
          requestId,
          redirects,
          downloadUrl,
          dataHash
        };

        const response = await fetch("/api/generate-data-packet-qr", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Failed to generate QR.");
        }

        qrImage.src = data.qrDataUrl;
        qrImage.alt = "QR Code for data packet request";
        deeplinkEl.value = data.deeplink;
        resultEl.hidden = false;
        setStatus(statusEl, "QR generated.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error.";
        showError(errorEl, message);
        setStatus(statusEl, "");
      } finally {
        submitButton.disabled = false;
      }
    });

    copyButton.addEventListener("click", async () => {
      if (!deeplinkEl.value) return;
      try {
        await navigator.clipboard.writeText(deeplinkEl.value);
        setStatus(statusEl, "Deeplink copied.");
        setTimeout(() => setStatus(statusEl, ""), 2000);
      } catch (error) {
        setStatus(statusEl, "Copy failed. Select and copy manually.");
      }
    });
  };

  // ── Init ─────────────────────────────────────────────────────────────

  setupTabs();
  setupUpdateForm();
  setupAuthForm();
  setupInvoiceForm();
  setupAppEncryptionForm();
  setupDataPacketForm();
  setupCopyButtons();
  wireGlobalSigningIdDropdown();
  loadIdentities();
  wireCurrencySearch();
  loadCurrencies();
})();
