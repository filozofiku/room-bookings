// Apps Script equivalent of the small SHA-256 API used by the shared mailer.
export function createHash(algorithm){
 if(algorithm!=='sha256')throw Error('Unsupported digest');
 let value='';return {update(text){value+=text;return this;},digest(format){
  if(format!=='hex')throw Error('Unsupported digest format');
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8).map(b=>(b&255).toString(16).padStart(2,'0')).join('');
 }};
}
