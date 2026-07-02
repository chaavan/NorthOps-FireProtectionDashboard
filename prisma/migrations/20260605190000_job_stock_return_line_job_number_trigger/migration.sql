-- Fill job_number on return lines from the parent return when Prisma omits the column.
CREATE OR REPLACE FUNCTION job_stock_return_line_set_job_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.job_number IS NULL OR BTRIM(NEW.job_number) = '' THEN
    SELECT jsr.job_number
    INTO NEW.job_number
    FROM job_stock_returns jsr
    WHERE jsr.id = NEW.job_stock_return_id;

    IF NEW.job_number IS NULL OR BTRIM(NEW.job_number) = '' THEN
      RAISE EXCEPTION
        'job_stock_return_lines.job_number is required (parent return % not found)',
        NEW.job_stock_return_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_stock_return_line_set_job_number ON job_stock_return_lines;

CREATE TRIGGER trg_job_stock_return_line_set_job_number
  BEFORE INSERT ON job_stock_return_lines
  FOR EACH ROW
  EXECUTE PROCEDURE job_stock_return_line_set_job_number();
