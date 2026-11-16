(() => {
  const TABS = "__tabs";
  const read = () => {
    try {
      const tabs = typeof __md_get === "function" ? __md_get(TABS) : null;
      return Array.isArray(tabs) ? tabs : [];
    } catch {
      return [];
    }
  };
  const write = (tabs) => {
    try {
      if (typeof __md_set === "function") __md_set(TABS, tabs);
    } catch {}
  };
  const scope = typeof __md_scope !== "undefined" ? __md_scope : new URL("/", location);
  const data = fetch(new URL("assets/integrations.json", scope)).then((response) => response.json()).catch(() => null);

  const chosen = (category, tabs) => tabs.map((label) => category.choices.find((choice) => choice.name === label)).find(Boolean) || null;

  const choose = (category, choice) => {
    const names = new Set(category.choices.map((entry) => entry.name));
    const rest = read().filter((label) => !names.has(label));
    write(choice ? [choice.name, ...rest] : rest);
  };

  const fromQuery = (categories) => {
    const params = new URLSearchParams(location.search);
    for (const category of categories) {
      const id = params.get(category.id);
      if (id === null) continue;
      choose(category, category.choices.find((choice) => choice.id === id) || null);
    }
  };

  const syncTabs = (tabs) => {
    for (const set of document.querySelectorAll(".tabbed-set")) {
      const labels = [...set.querySelectorAll(".tabbed-labels label")];
      const match = tabs.map((name) => labels.find((label) => label.innerText.trim() === name)).find(Boolean);
      if (match) document.getElementById(match.htmlFor).checked = true;
    }
  };

  const render = (categories) => {
    const tabs = read();
    const byId = Object.fromEntries(categories.map((category) => [category.id, category]));
    for (const link of document.querySelectorAll(".unfold-choice[data-choice]")) {
      const [id, field] = link.dataset.choice.split(".");
      const category = byId[id];
      if (!category) continue;
      if (!link.dataset.any) link.dataset.any = link.textContent;
      if (!link.dataset.hint) link.dataset.hint = link.title;
      const choice = chosen(category, tabs);
      const text = choice ? choice[field] : link.dataset.any;
      const target = link.querySelector("code") || link;
      target.textContent = text;
      link.title = choice ? `${category.label}: ${choice.name}. Change it under "Shown for".` : link.dataset.hint;
      link.classList.toggle("unfold-choice--chosen", Boolean(choice));
    }
    syncTabs(tabs);
    for (const select of document.querySelectorAll(".unfold-setup select")) {
      const choice = chosen(byId[select.name], tabs);
      select.value = choice ? choice.id : "";
    }
  };

  const picker = (categories) => {
    const article = document.querySelector("article");
    if (!article || article.querySelector(".unfold-setup")) return;
    const slot = article.querySelector("[data-unfold-setup]");
    if (!slot && !article.querySelector(".unfold-choice, .tabbed-set")) return;
    const bar = document.createElement("form");
    bar.className = "unfold-setup";
    bar.setAttribute("aria-label", "Shown for your integrations");
    const title = document.createElement("span");
    title.textContent = "Shown for";
    bar.append(title);
    for (const category of categories) {
      const label = document.createElement("label");
      label.append(`${category.label} `);
      const select = document.createElement("select");
      select.name = category.id;
      select.append(new Option(`Any ${category.label.toLowerCase()}`, ""));
      for (const choice of category.choices) select.append(new Option(choice.name, choice.id));
      select.addEventListener("change", () => {
        choose(category, category.choices.find((choice) => choice.id === select.value) || null);
        render(categories);
      });
      label.append(select);
      bar.append(label);
    }
    if (slot) slot.replaceWith(bar);
    else (article.querySelector("h1") || article.firstElementChild).after(bar);
  };

  const start = async () => {
    const config = await data;
    if (!config) return;
    fromQuery(config.categories);
    picker(config.categories);
    render(config.categories);
  };

  document.addEventListener("click", async (event) => {
    if (!event.target.closest(".tabbed-labels label")) return;
    const config = await data;
    if (config) setTimeout(() => render(config.categories));
  });

  if (typeof document$ !== "undefined" && document$.subscribe) document$.subscribe(start);
  else start();
})();
