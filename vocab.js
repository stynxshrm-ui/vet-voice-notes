// Terms the speech model often mangles. Given to the LLM so it can repair obvious mis-hearings
// ("a pock well" -> Apoquel). Extend per clinic.
export const VOCAB = [
  // drugs and brands
  'Apoquel', 'Cytopoint', 'Neptra', 'Osurnia', 'Surolan', 'Cortavance', 'Simparica', 'Bravecto', 'NexGard', 'Revolution', 'Seresto',
  'Credelio', 'Milbemax', 'Drontal', 'Metacam', 'Loxicom', 'Onsior', 'Previcox', 'Gabapentin', 'Trazodone', 'Fluoxetine',
  'Cefalexin', 'Clavulox', 'Synulox', 'Convenia', 'Baytril', 'Enrofloxacin', 'Metronidazole', 'Doxycycline', 'Prednisolone',
  'Dexamethasone', 'Vetmedin', 'Pimobendan', 'Frusemide', 'Cerenia', 'Maropitant', 'Ondansetron', 'Buprenorphine', 'Methadone',
  'Butorphanol', 'Medetomidine', 'Dexmedetomidine', 'Alfaxalone', 'Alfaxan', 'Propofol', 'Isoflurane', 'Ketamine', 'Atipamezole',
  'Hartmann\'s', 'Cardisure', 'Thyronorm', 'Vetoryl', 'Caninsulin',
  // vaccines
  'C3', 'C5', 'F3', 'F4', 'Kennel cough', 'Leptospirosis',
  // clinical shorthand
  'BAR', 'QAR', 'NAD', 'WNL', 'BCS', 'MM', 'CRT', 'TPR', 'PO', 'SC', 'IV', 'IM', 'SID', 'BID', 'TID', 'PRN', 'OU', 'OD', 'OS', 'AU',
  'AFAST', 'TFAST', 'Malassezia', 'otitis externa', 'pyoderma', 'periodontal', 'gingivitis', 'pancreatitis', 'cystocentesis',
];
