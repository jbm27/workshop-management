export const config = {
  port: process.env.PORT || 3001,
  company: {
    name: 'The Chequered Flag',
    legalName: 'THE CHEQUERED FLAG LTD',
    address: 'P.O Box 14483 Nairobi 00800',
    vatRegistration: '0021870Z',
    pin: 'P000608228X',
    phone: '+254733514965',
    email: 'reception@chequeredflag.co.ke',
    bank: {
      name: 'STANDARD CHARTERED BANK',
      branch: 'KAREN',
      accountNumber: '0102033958502',
      swiftCode: 'SCBLKENXXXX',
    },
    mpesa: {
      tillNumber: '211143',
    },
    paymentTerms: '60% deposit, balance upon collection',
    validityDays: 15,
  },
};
