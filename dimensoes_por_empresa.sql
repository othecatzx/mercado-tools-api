-- Execute UMA vez no Supabase SQL Editor, antes de publicar a nova API.
-- Faça backup da tabela bling_dimension_presets. Transação atômica.
BEGIN;
ALTER TABLE public.bling_dimension_presets ADD COLUMN IF NOT EXISTS company_id uuid;
-- Remove restrições únicas globais antigas de nome, preservando demais constraints.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.bling_dimension_presets'::regclass AND contype='u' AND pg_get_constraintdef(oid) ~* '\(nome\)' LOOP
  EXECUTE format('ALTER TABLE public.bling_dimension_presets DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
-- Remover índices UNIQUE isolados sobre nome (quando não associados a constraints).
DO $$ DECLARE i record; BEGIN
 FOR i IN SELECT ix.indexrelid::regclass::text AS idx
   FROM pg_index ix JOIN pg_attribute a ON a.attrelid=ix.indrelid AND a.attnum=ANY(ix.indkey)
   WHERE ix.indrelid='public.bling_dimension_presets'::regclass AND ix.indisunique AND NOT ix.indisprimary
   GROUP BY ix.indexrelid,ix.indrelid,ix.indkey HAVING count(*) FILTER(WHERE a.attname='nome')=1 AND count(*)=1
 LOOP EXECUTE format('DROP INDEX IF EXISTS %s',i.idx); END LOOP;
END $$;
-- Clona os antigos modelos globais (company_id NULL) para cada empresa existente.
INSERT INTO public.bling_dimension_presets (company_id,nome,peso,largura,altura,profundidade,ordem)
SELECT c.id, d.nome,d.peso,d.largura,d.altura,d.profundidade,d.ordem
FROM public.companies c CROSS JOIN public.bling_dimension_presets d
WHERE d.company_id IS NULL AND NOT EXISTS (
 SELECT 1 FROM public.bling_dimension_presets already
 WHERE already.company_id=c.id AND lower(already.nome)=lower(d.nome));
-- Apaga apenas os modelos antigos globais, após copiá-los para as empresas.
DELETE FROM public.bling_dimension_presets WHERE company_id IS NULL;
ALTER TABLE public.bling_dimension_presets ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.bling_dimension_presets DROP CONSTRAINT IF EXISTS bling_dimension_presets_company_id_fkey;
ALTER TABLE public.bling_dimension_presets ADD CONSTRAINT bling_dimension_presets_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS bling_dimension_presets_company_nome_uq ON public.bling_dimension_presets(company_id, lower(nome));
CREATE INDEX IF NOT EXISTS bling_dimension_presets_company_order_idx ON public.bling_dimension_presets(company_id,ordem);
-- Sem política aberta: a API usa Supabase service role e verifica a autorização a cada requisição.
ALTER TABLE public.bling_dimension_presets ENABLE ROW LEVEL SECURITY;
COMMIT;
