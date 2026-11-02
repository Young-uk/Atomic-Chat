const NAME_KEY = /^(?:user_|my_)?(?:full_|first_|last_|given_|family_|preferred_|display_|real_|nick_?)?name$|^(?:nickname|username|user_name|alias|handle|user_handle|user_identity|identity)$/;
function isNameProfileKey(key) {
  return NAME_KEY.test(key.toLowerCase());
}
function isNameGroundingStatus(value) {
  return value === "grounded" || value === "ungrounded" || value === "unverifiable";
}
function isProfileFactPromptVisible(fact) {
  if (!isNameProfileKey(fact.key)) return true;
  return fact.nameGrounding === "grounded" || fact.nameGrounding === "unverifiable";
}
function nameGroundingMarker(fact) {
  if (!isNameProfileKey(fact.key)) return null;
  switch (fact.nameGrounding ?? null) {
    case "ungrounded":
      return "unconfirmed: the user never wrote this name; not used until they confirm it";
    case null:
      return "not checked yet: not used until it is";
    default:
      return null;
  }
}
export {
  isNameGroundingStatus,
  isNameProfileKey,
  isProfileFactPromptVisible,
  nameGroundingMarker
};
