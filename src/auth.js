export function validateSignup(input){
  var name=String(input&&input.name||'').trim();
  var password=String(input&&input.password||'');
  var confirmation=String(input&&input.confirmation||'');
  if(name.length<2) return 'Enter your full name.';
  if(password.length<8) return 'Use a password with at least 8 characters.';
  if(password!==confirmation) return 'Passwords do not match.';
  return '';
}
