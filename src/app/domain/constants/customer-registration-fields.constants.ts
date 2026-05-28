export const CUSTOMER_REGISTRATION_FIELDS = [
  'CPF do Cliente',
  'Nome do Cliente Completo',
  'Declaração de Propósitos',
  'Movimentação de Conta de Depósito/Poupança',
  'Empréstimos/Financiamentos',
  'Financiamento Habitacional',
  'Investimentos',
  'Cartão de Crédito',
  'Seguros/Previdência Privada/Capitalização/Consórcios',
  'Operações Internacionais/Câmbio',
  'Nome do Cliente Reduzido',
  'Data de Nascimento',
  'Sexo',
  'Nacionalidade',
  'Naturalidade UF',
  'Naturalidade Município',
  'Nome do Pai',
  'Nome da Mãe',
  'Grau de Instrução',
  'PIS/NIS',
  'Tipo de Documento de Identificação',
  'Número da Carteira Nacional de Habilitação',
  'Órgão Emissor',
  'UF do Documento',
  'Data da 1ª Habilitação',
  'Data de Emissão',
  'Data Fim Validade',
  'Estado Civil',
  'Tipo de Ocupação',
  'Ocupação',
  'CEP',
  'Tipo de Logradouro',
  'Endereço',
  'Número',
  'Complemento',
  'Bairro',
  'UF do Endereço',
  'Município',
  'Tipo de Imóvel',
  'Ocupação do Imóvel',
  'Mês do Comprovante de Residência',
  'Ano do Comprovante de Residência',
  'Telefone Celular DDD',
  'Telefone Celular Número',
  'E-mail',
  'Característica da Renda',
  'Tipo de Fonte',
  'CPF/CNPJ da Fonte Pagadora',
  'Nome da Fonte Pagadora',
  'Ocupação da Renda Formal',
  'Data de Admissão',
  'Renda Bruta',
  'Renda Líquida',
  'Número de Dependentes',
  'Despesa Mensal com Aluguel',
  'Despesa Mensal com Condomínio',
  'Despesa Mensal com Pensão Alimentícia',
  'Agência de Relacionamento UF',
  'Agência de Relacionamento Município',
  'Código e Nome da Agência',
] as const;

export type CustomerRegistrationField =
  (typeof CUSTOMER_REGISTRATION_FIELDS)[number];

export type CustomerRegistrationData = Record<CustomerRegistrationField, string>;

export function emptyCustomerRegistrationData(): CustomerRegistrationData {
  return CUSTOMER_REGISTRATION_FIELDS.reduce((data, field) => {
    data[field] = '';
    return data;
  }, {} as CustomerRegistrationData);
}
