IF DB_ID(N'KarinaPolo') IS NULL
BEGIN
    CREATE DATABASE [KarinaPolo];
END;
GO

USE [KarinaPolo];
GO

IF OBJECT_ID(N'dbo.appointments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.appointments (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_appointments PRIMARY KEY,
        customer_name NVARCHAR(120) NOT NULL,
        customer_phone NVARCHAR(30) NOT NULL,
        customer_email NVARCHAR(254) NULL,
        service NVARCHAR(80) NOT NULL,
        appointment_date DATE NOT NULL,
        appointment_time TIME(0) NOT NULL,
        price_cop INT NOT NULL CONSTRAINT CK_appointments_price CHECK (price_cop >= 0),
        status NVARCHAR(20) NOT NULL CONSTRAINT DF_appointments_status DEFAULT N'pending',
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_appointments_created_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_appointments_status CHECK (status IN (N'pending', N'confirmed', N'cancelled')),
        CONSTRAINT UQ_appointments_slot UNIQUE (appointment_date, appointment_time)
    );

    CREATE INDEX IX_appointments_date_status
        ON dbo.appointments (appointment_date, status);
END;
GO
