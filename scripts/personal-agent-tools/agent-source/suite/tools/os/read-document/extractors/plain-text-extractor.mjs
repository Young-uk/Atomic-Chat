const plainTextExtractor = async (input) => {
  const warnings = [];
  let text = input.data.toString("utf8");
  if (text.includes("\uFFFD")) {
    const latin = input.data.toString("latin1");
    if (!latin.includes("\uFFFD")) {
      text = latin;
      warnings.push(
        "decoded with latin1 fallback: UTF-8 yielded replacement characters"
      );
    } else {
      warnings.push("UTF-8 decode produced replacement characters");
    }
  }
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return {
    format: "plain",
    text,
    warnings
  };
};
export {
  plainTextExtractor
};
