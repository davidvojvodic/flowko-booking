export const contructEmailFromPhoneNumber = (phoneNumber: string) => {
  // Digits only: a number that passes isValidPhoneNumber can still end in ";isub=" followed by any
  // characters, including "@", "," and ">", which must not end up in an email address.
  const cleanedPhoneNumber = phoneNumber.replace(/\D/g, "");
  return `${cleanedPhoneNumber}@sms.cal.com`;
};
