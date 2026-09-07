using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeExcursion.Api.Migrations.Home
{
    /// <inheritdoc />
    public partial class AddPurchaseLineItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PurchaseLineItemId",
                schema: "home",
                table: "PurchaseAllocations",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PurchaseLineItems",
                schema: "home",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PurchaseId = table.Column<int>(type: "int", nullable: false),
                    ReceiptText = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    Quantity = table.Column<decimal>(type: "decimal(12,3)", precision: 12, scale: 3, nullable: true),
                    UnitPrice = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: true),
                    LineTotal = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseLineItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PurchaseLineItems_Purchases_PurchaseId",
                        column: x => x.PurchaseId,
                        principalSchema: "home",
                        principalTable: "Purchases",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseAllocations_PurchaseLineItemId",
                schema: "home",
                table: "PurchaseAllocations",
                column: "PurchaseLineItemId",
                unique: true,
                filter: "[PurchaseLineItemId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseLineItems_PurchaseId_SortOrder",
                schema: "home",
                table: "PurchaseLineItems",
                columns: new[] { "PurchaseId", "SortOrder" });

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseAllocations_PurchaseLineItems_PurchaseLineItemId",
                schema: "home",
                table: "PurchaseAllocations",
                column: "PurchaseLineItemId",
                principalSchema: "home",
                principalTable: "PurchaseLineItems",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseAllocations_PurchaseLineItems_PurchaseLineItemId",
                schema: "home",
                table: "PurchaseAllocations");

            migrationBuilder.DropTable(
                name: "PurchaseLineItems",
                schema: "home");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseAllocations_PurchaseLineItemId",
                schema: "home",
                table: "PurchaseAllocations");

            migrationBuilder.DropColumn(
                name: "PurchaseLineItemId",
                schema: "home",
                table: "PurchaseAllocations");
        }
    }
}
