(() => {
  const copy = {
    pt: ["Está sem ligação à internet.", "O chat e os dados do Maio precisam de internet. Volte a ligar-se e tente novamente.", "Tentar novamente", "Sem ligação à internet · maio.cv"],
    en: ["You’re offline.", "Maio’s chat and data need an internet connection. Reconnect and try again.", "Try again", "You’re offline · maio.cv"],
    fr: ["Vous êtes hors connexion.", "Le chat et les données de Maio nécessitent une connexion internet. Reconnectez-vous et réessayez.", "Réessayer", "Hors connexion · maio.cv"],
  };
  const segment = window.location.pathname.split("/")[1];
  const locale = Object.hasOwn(copy, segment) ? segment : "pt";
  const [heading, description, retry, title] = copy[locale];
  document.documentElement.lang = locale;
  document.title = title;
  document.getElementById("heading").textContent = heading;
  document.getElementById("description").textContent = description;
  const retryLink = document.getElementById("retry");
  retryLink.textContent = retry;
  retryLink.href = window.location.pathname === "/offline.html" ? `/${locale}` : window.location.href;
})();
