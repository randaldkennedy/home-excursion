using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeExcursion.Api.Migrations.Home
{
    /// <inheritdoc />
    public partial class AddVendors : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "VendorId",
                schema: "home",
                table: "Expenses",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Vendors",
                schema: "home",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Phone = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    Email = table.Column<string>(type: "nvarchar(254)", maxLength: 254, nullable: true),
                    Website = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    Address1 = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: true),
                    Address2 = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: true),
                    City = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    State = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    PostalCode = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Vendors", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Expenses_VendorId",
                schema: "home",
                table: "Expenses",
                column: "VendorId");

            migrationBuilder.CreateIndex(
                name: "IX_Vendors_Name",
                schema: "home",
                table: "Vendors",
                column: "Name");

            migrationBuilder.AddForeignKey(
                name: "FK_Expenses_Vendors_VendorId",
                schema: "home",
                table: "Expenses",
                column: "VendorId",
                principalSchema: "home",
                principalTable: "Vendors",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Expenses_Vendors_VendorId",
                schema: "home",
                table: "Expenses");

            migrationBuilder.DropTable(
                name: "Vendors",
                schema: "home");

            migrationBuilder.DropIndex(
                name: "IX_Expenses_VendorId",
                schema: "home",
                table: "Expenses");

            migrationBuilder.DropColumn(
                name: "VendorId",
                schema: "home",
                table: "Expenses");
        }
    }
}
