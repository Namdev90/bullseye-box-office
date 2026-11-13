'use strict';
try{
  const receipt=SharePassDrafts.receiptDetails(location.href);
  document.getElementById('pickup-code').textContent=receipt.code;
  document.getElementById('pickup-qr').append(SharePassDrafts.qrImage(location.href,'Current pickup receipt QR'));
}catch{
  document.getElementById('pickup-status').textContent='This pickup receipt could not be read. Ask the sender for the current receipt link.';
}
