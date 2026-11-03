-- ShopMix — schema relacional (PostgreSQL / Supabase)
-- Espelha a camada local shopmix.db.v1 e prepara produção com auth gerenciado.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE user_role AS ENUM ('customer', 'seller', 'admin');
CREATE TYPE seller_app_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE product_status AS ENUM ('draft', 'pending', 'published', 'archived');
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'shipped', 'delivered', 'cancelled');

CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role user_role NOT NULL DEFAULT 'customer',
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  cpf CHAR(11),
  password_hash TEXT NOT NULL,
  terms_accepted_at TIMESTAMPTZ,
  legal_consents JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_profiles (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  default_cep CHAR(8),
  default_address JSONB,
  marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
  wants_seller BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seller_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  store_name TEXT NOT NULL,
  cnpj CHAR(14) NOT NULL,
  category TEXT NOT NULL,
  about TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  fiscal_cep CHAR(8),
  status seller_app_status NOT NULL DEFAULT 'pending',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT
);

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  owner_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  application_id UUID REFERENCES seller_applications(id),
  name TEXT NOT NULL,
  cnpj CHAR(14) NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  official BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(12, 2) NOT NULL,
  old_price NUMERIC(12, 2),
  stock INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  gallery JSONB NOT NULL DEFAULT '[]',
  condition TEXT NOT NULL DEFAULT 'novo',
  shipping TEXT NOT NULL DEFAULT 'rapido',
  free_shipping BOOLEAN NOT NULL DEFAULT false,
  tags TEXT[] NOT NULL DEFAULT '{}',
  featured BOOLEAN NOT NULL DEFAULT false,
  deal BOOLEAN NOT NULL DEFAULT false,
  live BOOLEAN NOT NULL DEFAULT false,
  rating NUMERIC(3, 2) NOT NULL DEFAULT 4.5,
  reviews INTEGER NOT NULL DEFAULT 0,
  sold INTEGER NOT NULL DEFAULT 0,
  status product_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL UNIQUE,
  total NUMERIC(12, 2) NOT NULL,
  status order_status NOT NULL DEFAULT 'pending',
  shipping_address JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL,
  variant JSONB
);

CREATE TABLE wishlists (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_products_store ON products(store_id);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_orders_user ON orders(user_id);

-- Cópia local (SQLite) também guarda o navegador de cada conta ou visitante.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  user_id UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  cep TEXT,
  consent_json JSONB,
  legacy_orders_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  token_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cart_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0 AND qty <= 99),
  color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT ''
);

CREATE TABLE list_items (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('recent', 'compare')),
  product_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, kind, position)
);
