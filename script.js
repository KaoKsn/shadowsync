const clickables = {
  anchors: {
    background: "#dcfce7",
    tag: "a",
  },
  buttons: {
    background: "#f3e8ff",
    tag: "button",
  },
  inputs: {
    background: "#e0f2fe",
    tag: "input",
  },
  textareas: {
    background: "#fef3c7",
    tag: "textarea",
  },
};
function markit(background, type, tag, counter) {
  console.log(`Marking ${type}..`);

  let items = document.querySelectorAll(`${tag}`);
  console.log(`Found ${items.length} ${type} tags.`);

  items.forEach((item) => {
    const span = document.createElement("span");
    span.className = "counter-icon";
    span.textContent = `⭐${counter.value++}`;
    span.style.background = `${background}`;

    item.insertAdjacentElement("beforebegin", span);
  });
  return items.length;
}
function analyse() {
  document.querySelectorAll(".counter-icon").forEach((span) => {
    span.remove();
  });

  const counter = {
    value: 1,
  };

  for (const type in clickables) {
    const clickable = clickables[type];

    markit(clickable.background, type, clickable.tag, counter);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const start = performance.now();
  try {
    analyse();
  } finally {
    const duration = performance.now() - start;
    console.log(`Processing complete. Took: ${duration.toFixed(2)} ms`);
  }
});
