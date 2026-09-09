using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeExcursion.Api.Migrations.Home
{
    /// <inheritdoc />
    public partial class AddVendorContractorFlag : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsContractor",
                schema: "home",
                table: "Vendors",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_Vendors_IsContractor_IsActive_Name",
                schema: "home",
                table: "Vendors",
                columns: new[] { "IsContractor", "IsActive", "Name" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Vendors_IsContractor_IsActive_Name",
                schema: "home",
                table: "Vendors");

            migrationBuilder.DropColumn(
                name: "IsContractor",
                schema: "home",
                table: "Vendors");
        }
    }
}
