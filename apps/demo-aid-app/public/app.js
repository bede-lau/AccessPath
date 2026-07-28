(() => {
  "use strict";

  const stepPanels = [...document.querySelectorAll("[data-step]")];
  const progressItems = [...document.querySelectorAll("[data-progress-step]")];
  const eligibilityOptions = [
    ...document.querySelectorAll("[data-eligibility-value]"),
  ];
  const eligibilityNext = document.querySelector(
    "[data-action='eligibility-next']",
  );
  const profileForm = document.querySelector("[data-form='profile']");
  const assistanceForm = document.querySelector("[data-form='assistance']");
  const reviewForm = document.querySelector("[data-form='review']");
  const reviewErrorSummary = document.querySelector(
    "[data-testid='review-error-summary']",
  );
  const confirmationError = document.querySelector("#confirmation-error");
  const fictionalConfirmation = reviewForm.elements.fictionalDataConfirmed;

  const application = {
    eligibility: "",
    fullName: "Jordan Example",
    phone: "202-555-0148",
    assistanceTypes: [],
  };

  function showStep(step, moveFocus = true) {
    for (const panel of stepPanels) {
      panel.hidden = Number(panel.dataset.step) !== step;
    }
    for (const item of progressItems) {
      const itemStep = Number(item.dataset.progressStep);
      item.removeAttribute("aria-current");
      item.dataset.complete = itemStep < step ? "true" : "false";
      if (itemStep === step) {
        item.setAttribute("aria-current", "step");
      }
    }

    if (moveFocus) {
      const heading = document.querySelector(`[data-step='${step}'] h1`);
      if (heading instanceof HTMLElement) {
        heading.focus();
      }
    }
  }

  function assistanceLabel(value) {
    return {
      housing: "Rent or temporary housing",
      utilities: "Essential utilities",
      food: "Food and household supplies",
    }[value];
  }

  function populateReview() {
    document.querySelector("[data-review='eligibility']").textContent =
      application.eligibility === "yes"
        ? "Household needs essential-cost help"
        : "Household is not sure";
    document.querySelector("[data-review='fullName']").textContent =
      application.fullName;
    document.querySelector("[data-review='phone']").textContent =
      application.phone;
    document.querySelector("[data-review='assistanceTypes']").textContent =
      application.assistanceTypes.map(assistanceLabel).join(", ");
  }

  for (const option of eligibilityOptions) {
    // AP-001 is intentional: pointer click only, with no role, tabindex, or key handler.
    option.addEventListener("click", () => {
      application.eligibility = option.dataset.eligibilityValue;
      for (const candidate of eligibilityOptions) {
        candidate.dataset.selected = String(candidate === option);
      }
      eligibilityNext.disabled = false;
    });
  }

  eligibilityNext.addEventListener("click", () => showStep(2));

  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!profileForm.reportValidity()) {
      return;
    }
    const values = new FormData(profileForm);
    application.fullName = String(values.get("fullName") ?? "").trim();
    application.phone = String(values.get("phone") ?? "").trim();
    showStep(3);
  });

  assistanceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(assistanceForm);
    application.assistanceTypes = values
      .getAll("assistanceType")
      .map(String);
    const error = document.querySelector("[data-assistance-error]");
    if (application.assistanceTypes.length === 0) {
      error.hidden = false;
      const firstChoice = assistanceForm.querySelector(
        "input[name='assistanceType']",
      );
      firstChoice.focus();
      return;
    }
    error.hidden = true;
    populateReview();
    showStep(4);
  });

  reviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!fictionalConfirmation.checked) {
      // AP-004 is intentional: show the summary without focusing it and without
      // linking the summary text to the invalid control.
      reviewErrorSummary.hidden = false;
      confirmationError.hidden = false;
      fictionalConfirmation.setAttribute("aria-invalid", "true");
      return;
    }

    reviewErrorSummary.hidden = true;
    confirmationError.hidden = true;
    fictionalConfirmation.removeAttribute("aria-invalid");

    const submitButton = reviewForm.querySelector("button[type='submit']");
    submitButton.disabled = true;
    try {
      const response = await fetch("/api/test-submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...application,
          fictionalDataConfirmed: true,
        }),
      });
      if (!response.ok) {
        throw new Error("The local test submission could not be stored.");
      }
      const result = await response.json();
      document.querySelector("[data-submission-reference]").textContent =
        result.reference;
      // AP-005 is intentional: the confirmation is visual only and is not a
      // status/live region.
      showStep(5, false);
    } catch {
      reviewErrorSummary.hidden = false;
      reviewErrorSummary.querySelector("p").textContent =
        "The local test submission could not be stored. Try again.";
    } finally {
      submitButton.disabled = false;
    }
  });

  for (const backButton of document.querySelectorAll("[data-action='back']")) {
    backButton.addEventListener("click", () => {
      const panel = backButton.closest("[data-step]");
      showStep(Number(panel.dataset.step) - 1);
    });
  }

  document
    .querySelector("[data-action='start-over']")
    .addEventListener("click", async () => {
      await fetch("/__fixture/reset", { method: "POST" });
      window.location.reload();
    });
})();
