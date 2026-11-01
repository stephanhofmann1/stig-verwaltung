BEGIN;

-- Wann wurde die Wohnungsgeberbestätigung übergeben?
--
-- § 19 Abs. 1 BMG: Der Wohnungsgeber muss dem Mieter den Einzug schriftlich
-- bestätigen. § 17 Abs. 1 BMG: Der Mieter muss sich binnen **zwei Wochen**
-- nach dem Einzug anmelden -- und dazu braucht er diese Bestätigung. Ohne
-- sie kann er die Frist nicht einhalten, und die Ordnungswidrigkeit nach
-- § 54 Abs. 2 Nr. 1 BMG trifft dann den Wohnungsgeber, nicht ihn.
--
-- Deshalb ein eigenes Datum und nicht nur "erzeugt": Ein erzeugtes PDF, das
-- im Downloadordner liegt, hilft dem Mieter nicht. Zählt, was bei ihm
-- angekommen ist.
--
-- NULL heißt offen. Auch bei den übernommenen Altmietern, die seit Jahren
-- dort wohnen -- für die ist die Frist längst abgelaufen und die
-- Bestätigung meist nie erstellt worden. Die Überwachung blendet sie über
-- ein Stichdatum aus, statt hier etwas zu behaupten, das niemand geprüft
-- hat.

ALTER TABLE mietverhaeltnis
    ADD COLUMN IF NOT EXISTS wgb_uebergeben_am date;

COMMENT ON COLUMN mietverhaeltnis.wgb_uebergeben_am IS
    'Tag, an dem die Wohnungsgeberbestätigung (§ 19 BMG) beim Mieter war. '
    'NULL = offen.';

COMMIT;
