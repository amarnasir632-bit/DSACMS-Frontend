/**
 * DSACMS - Navigation Bar & Floating Controls Component
 * Handles mobile drawer, accessible menu toggle, active links, and circular back-to-top button.
 */

export function initNavbar() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  const overlay = document.querySelector(".nav-overlay");
  const closeButton = nav ? nav.querySelector(".nav-close") : null;

  const setMenuOpen = (open) => {
    if (!nav || !toggle) return;
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
    if (overlay) {
      overlay.classList.toggle("is-visible", open);
    }
    if (open) {
      document.body.style.overflow = "hidden";
      const firstLink = nav.querySelector("a, button");
      if (firstLink) firstLink.focus();
    } else {
      document.body.style.overflow = "";
    }
  };

  if (toggle && nav) {
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = toggle.getAttribute("aria-expanded") === "true";
      setMenuOpen(!isOpen);
    });

    if (closeButton) {
      closeButton.addEventListener("click", () => setMenuOpen(false));
    }

    if (overlay) {
      overlay.addEventListener("click", () => setMenuOpen(false));
    }

    // Close menu with Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setMenuOpen(false);
        toggle.focus();
      }
    });

    // Close menu after clicking any nav link
    nav.addEventListener("click", (e) => {
      const link = e.target.closest("a");
      if (link && !link.classList.contains("dropdown-toggle")) {
        setMenuOpen(false);
      }
    });

    // Handle Dropdown menu toggle on mobile/click
    const dropdownToggle = nav.querySelector(".dropdown-toggle");
    const dropdownMenu = nav.querySelector(".dropdown-menu");
    if (dropdownToggle && dropdownMenu) {
      dropdownToggle.addEventListener("click", (e) => {
        e.preventDefault();
        const expanded = dropdownToggle.getAttribute("aria-expanded") === "true";
        dropdownToggle.setAttribute("aria-expanded", String(!expanded));
        dropdownMenu.style.display = expanded ? "none" : "block";
      });
    }
  }

  // Set aria-current="page" on current active link
  highlightCurrentPage();

  // Initialize circular Back-to-Top button (no bottom button)
  initBackToTopButton();
}

/**
 * Highlights current active page in navigation
 */
function highlightCurrentPage() {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll(".site-nav a");

  navLinks.forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) return;

    const isCurrent =
      (currentPath.endsWith("/") && (href === "index.html" || href === "./index.html" || href === "/")) ||
      (currentPath.includes(href) && href !== "#");

    if (isCurrent) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

/**
 * Manages the compact circular back-to-top button
 */
function initBackToTopButton() {
  // Remove any legacy scroll controls if they exist in DOM
  const legacyControls = document.querySelector(".scroll-controls");
  if (legacyControls) legacyControls.remove();

  let btn = document.getElementById("back-to-top");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "back-to-top";
    btn.className = "back-to-top";
    btn.setAttribute("aria-label", "الرجوع إلى أعلى الصفحة");
    btn.title = "الرجوع إلى أعلى الصفحة";
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="18 15 12 9 6 15"/>
      </svg>
    `;
    document.body.appendChild(btn);
  }

  const handleScroll = () => {
    // Show only when scrollY > 400px
    if (window.scrollY > 400) {
      btn.classList.add("is-visible");
    } else {
      btn.classList.remove("is-visible");
    }
  };

  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.addEventListener("scroll", handleScroll, { passive: true });
  handleScroll();
}
